import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { createAppointment } from "@/modules/appointments/service";
import { requireCurrentUser } from "@/modules/auth/current-user";
import { sendBookingConfirmation } from "@/modules/notifications/service";

const createSchema = z.object({
  clinicId: z.string().min(1),
  providerId: z.string().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  patientId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional()
});

export async function POST(req: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const patientId =
      currentUser.role === Role.RECEPTIONIST
        ? parsed.data.patientId
        : currentUser.patientProfileId ?? undefined;

    if (!patientId) {
      return NextResponse.json(
        { error: "patientId is required for receptionist bookings" },
        { status: 400 }
      );
    }

    const appointment = await createAppointment({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      actorRole: currentUser.role,
      clinicId: parsed.data.clinicId,
      providerId: parsed.data.providerId,
      patientId,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      notes: parsed.data.notes
    });

    sendBookingConfirmation(appointment.id).catch((err) =>
      console.error("[Confirmation] Failed:", err)
    );

    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to create appointment", message: (error as Error).message },
      { status: 400 }
    );
  }
}

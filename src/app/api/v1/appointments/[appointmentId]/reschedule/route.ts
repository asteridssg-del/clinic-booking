import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rescheduleAppointment } from "@/modules/appointments/service";
import { requireCurrentUser } from "@/modules/auth/current-user";

const schema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  providerId: z.string().min(1).optional()
});

type Context = { params: Promise<{ appointmentId: string }> };

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const currentUser = await requireCurrentUser();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { appointmentId } = await context.params;
    const appointment = await rescheduleAppointment({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      actorRole: currentUser.role,
      actorPatientProfileId: currentUser.patientProfileId,
      appointmentId,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      providerId: parsed.data.providerId
    });

    return NextResponse.json(appointment);
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((error as Error).message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to reschedule appointment", message: (error as Error).message },
      { status: 400 }
    );
  }
}

import { AppointmentStatus, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { receptionistTransition } from "@/modules/appointments/service";
import { requireCurrentUser } from "@/modules/auth/current-user";

type Context = { params: Promise<{ appointmentId: string }> };

export async function POST(_: Request, context: Context) {
  try {
    const currentUser = await requireCurrentUser();
    if (currentUser.role !== Role.RECEPTIONIST) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { appointmentId } = await context.params;
    const appointment = await receptionistTransition({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      appointmentId,
      nextStatus: AppointmentStatus.NO_SHOW
    });

    return NextResponse.json(appointment);
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to mark no-show", message: (error as Error).message },
      { status: 400 }
    );
  }
}

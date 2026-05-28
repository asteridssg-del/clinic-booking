import { NextResponse } from "next/server";
import { cancelAppointment } from "@/modules/appointments/service";
import { requireCurrentUser } from "@/modules/auth/current-user";

type Context = { params: Promise<{ appointmentId: string }> };

export async function POST(_: Request, context: Context) {
  try {
    const currentUser = await requireCurrentUser();
    const { appointmentId } = await context.params;

    const appointment = await cancelAppointment({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      actorRole: currentUser.role,
      actorPatientProfileId: currentUser.patientProfileId,
      appointmentId
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
      { error: "Failed to cancel appointment", message: (error as Error).message },
      { status: 400 }
    );
  }
}

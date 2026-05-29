import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireCurrentUser } from "@/modules/auth/current-user";
import { db } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ providerId: string; timeOffId: string }> }
) {
  try {
    const currentUser = await requireCurrentUser();
    if (currentUser.role !== Role.RECEPTIONIST) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { providerId, timeOffId } = await params;

    const record = await db.providerTimeOff.findFirst({
      where: {
        id: timeOffId,
        providerId,
        provider: { clinic: { tenantId: currentUser.tenantId } }
      },
      select: { id: true }
    });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.providerTimeOff.delete({ where: { id: timeOffId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

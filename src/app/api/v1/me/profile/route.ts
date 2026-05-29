import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireCurrentUser } from "@/modules/auth/current-user";
import { db } from "@/lib/db";

const updateSchema = z.object({
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, "Must be a valid E.164 phone number")
});

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();

    if (currentUser.role !== Role.PATIENT || !currentUser.patientProfileId) {
      return NextResponse.json({ error: "Only patients can update their profile" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await db.patientProfile.update({
      where: { id: currentUser.patientProfileId },
      data: { phoneE164: parsed.data.phoneE164 }
    });

    return NextResponse.json({ phoneE164: updated.phoneE164 });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

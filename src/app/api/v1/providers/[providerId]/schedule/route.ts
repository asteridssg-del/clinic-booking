import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireCurrentUser } from "@/modules/auth/current-user";
import { db } from "@/lib/db";

const patchSchema = z.object({
  weekday:   z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM"),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM"),
  breakJson: z.array(z.object({
    startTime: z.string(),
    endTime:   z.string()
  })).optional()
});

async function resolveProvider(providerId: string, tenantId: string) {
  return db.provider.findFirst({
    where: { id: providerId, clinic: { tenantId, active: true } },
    select: { id: true }
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  try {
    const currentUser = await requireCurrentUser();
    if (currentUser.role !== Role.RECEPTIONIST) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { providerId } = await params;
    const provider = await resolveProvider(providerId, currentUser.tenantId);
    if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

    const schedules = await db.providerSchedule.findMany({
      where: { providerId },
      orderBy: { weekday: "asc" }
    });
    return NextResponse.json(schedules);
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  try {
    const currentUser = await requireCurrentUser();
    if (currentUser.role !== Role.RECEPTIONIST) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { providerId } = await params;
    const provider = await resolveProvider(providerId, currentUser.tenantId);
    if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    const { weekday, startTime, endTime, breakJson } = parsed.data;

    const [, created] = await db.$transaction([
      db.providerSchedule.deleteMany({ where: { providerId, weekday } }),
      db.providerSchedule.create({
        data: { providerId, weekday, startTime, endTime, breakJson: breakJson ?? [] }
      })
    ]);

    return NextResponse.json(created);
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

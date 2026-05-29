import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireCurrentUser } from "@/modules/auth/current-user";
import { db } from "@/lib/db";

const postSchema = z.object({
  startAt: z.coerce.date(),
  endAt:   z.coerce.date(),
  reason:  z.string().max(500).optional()
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

    const timeOff = await db.providerTimeOff.findMany({
      where: { providerId, endAt: { gte: new Date() } },
      orderBy: { startAt: "asc" }
    });
    return NextResponse.json(timeOff);
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(
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
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.startAt >= parsed.data.endAt) {
      return NextResponse.json({ error: "startAt must be before endAt" }, { status: 400 });
    }

    const created = await db.providerTimeOff.create({
      data: {
        providerId,
        startAt: parsed.data.startAt,
        endAt:   parsed.data.endAt,
        reason:  parsed.data.reason
      }
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

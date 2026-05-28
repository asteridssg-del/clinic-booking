import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getProviderAvailability } from "@/modules/availability/service";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotMinutes: z.coerce.number().int().min(1).max(120).optional()
});

type Context = {
  params: Promise<{ providerId: string }>;
};

export async function GET(req: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    slotMinutes: url.searchParams.get("slotMinutes") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { providerId } = await context.params;
    const result = await getProviderAvailability({
      tenantId: session.user.tenantId,
      providerId,
      fromDate: parsed.data.from,
      toDate: parsed.data.to,
      slotMinutes: parsed.data.slotMinutes
    });

    if (!result) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get availability", message: (error as Error).message },
      { status: 400 }
    );
  }
}

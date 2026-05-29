import { NextRequest, NextResponse } from "next/server";
import { AppointmentStatus, ReminderStatus, ReminderType } from "@prisma/client";
import { db } from "@/lib/db";
import { sendAppointmentReminder } from "@/modules/notifications/service";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const ACTIVE = [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED];

  const [t24Candidates, t2Candidates] = await Promise.all([
    db.appointment.findMany({
      where: {
        status: { in: ACTIVE },
        startAt: {
          gte: new Date(now.getTime() + 23 * 60 * 60_000),
          lte: new Date(now.getTime() + 25 * 60 * 60_000)
        },
        reminders: {
          none: { type: ReminderType.T24, status: { in: [ReminderStatus.SENT, ReminderStatus.QUEUED] } }
        }
      },
      select: { id: true }
    }),
    db.appointment.findMany({
      where: {
        status: { in: ACTIVE },
        startAt: {
          gte: new Date(now.getTime() + 110 * 60_000),
          lte: new Date(now.getTime() + 130 * 60_000)
        },
        reminders: {
          none: { type: ReminderType.T2, status: { in: [ReminderStatus.SENT, ReminderStatus.QUEUED] } }
        }
      },
      select: { id: true }
    })
  ]);

  const t24Results = await Promise.allSettled(
    t24Candidates.map((a) => sendAppointmentReminder(a.id, ReminderType.T24))
  );
  const t2Results = await Promise.allSettled(
    t2Candidates.map((a) => sendAppointmentReminder(a.id, ReminderType.T2))
  );

  const count = (results: PromiseSettledResult<unknown>[], fulfilled: boolean) =>
    results.filter((r) => (fulfilled ? r.status === "fulfilled" : r.status === "rejected")).length;

  return NextResponse.json({
    t24: { total: t24Candidates.length, sent: count(t24Results, true), failed: count(t24Results, false) },
    t2:  { total: t2Candidates.length,  sent: count(t2Results, true),  failed: count(t2Results, false) }
  });
}

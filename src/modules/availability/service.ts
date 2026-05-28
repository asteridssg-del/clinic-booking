import { AppointmentStatus, type ProviderSchedule, type ProviderTimeOff } from "@prisma/client";
import { db } from "@/lib/db";

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN
];

type TimeRange = { start: Date; end: Date };

function parseYmd(date: string) {
  const [y, m, d] = date.split("-").map((v) => Number(v));
  if (!y || !m || !d) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
  }
  return { y, m, d };
}

function getUtcOffsetMinutes(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit"
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;

  if (!part) return 0;
  const match = part.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function zonedLocalTimeToUtcDate(localDate: string, hhmm: string, timeZone: string): Date {
  const { y, m, d } = parseYmd(localDate);
  const [h, min] = hhmm.split(":").map((v) => Number(v));
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));

  const firstOffset = getUtcOffsetMinutes(guess, timeZone);
  const firstPass = new Date(guess.getTime() - firstOffset * 60_000);
  const secondOffset = getUtcOffsetMinutes(firstPass, timeZone);

  if (secondOffset === firstOffset) return firstPass;
  return new Date(guess.getTime() - secondOffset * 60_000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && a.end > b.start;
}

function toYmdRange(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error("Invalid date range");
  }

  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function getWeekdayFromYmd(date: string): number {
  const { y, m, d } = parseYmd(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseBreaks(schedule: ProviderSchedule): Array<{ startTime: string; endTime: string }> {
  if (!schedule.breakJson || typeof schedule.breakJson !== "object") return [];
  if (!Array.isArray(schedule.breakJson)) return [];
  return schedule.breakJson
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { startTime?: string; endTime?: string };
      if (!candidate.startTime || !candidate.endTime) return null;
      return { startTime: candidate.startTime, endTime: candidate.endTime };
    })
    .filter((item): item is { startTime: string; endTime: string } => Boolean(item));
}

export async function getProviderAvailability(params: {
  tenantId: string;
  providerId: string;
  fromDate: string;
  toDate: string;
  slotMinutes?: number;
}) {
  const slotMinutes = params.slotMinutes ?? 15;
  if (slotMinutes <= 0 || slotMinutes > 120) {
    throw new Error("slotMinutes must be between 1 and 120");
  }

  const provider = await db.provider.findFirst({
    where: {
      id: params.providerId,
      clinic: { tenantId: params.tenantId, active: true },
      active: true
    },
    include: {
      clinic: true,
      schedules: true
    }
  });

  if (!provider) {
    return null;
  }

  const days = toYmdRange(params.fromDate, params.toDate);
  if (days.length > 31) {
    throw new Error("Date range too large. Max 31 days.");
  }

  const overallStart = zonedLocalTimeToUtcDate(days[0], "00:00", provider.clinic.timezone);
  const overallEnd = zonedLocalTimeToUtcDate(days[days.length - 1], "23:59", provider.clinic.timezone);

  const [appointments, timeOff] = await Promise.all([
    db.appointment.findMany({
      where: {
        providerId: provider.id,
        startAt: { lte: overallEnd },
        endAt: { gte: overallStart },
        status: { in: ACTIVE_APPOINTMENT_STATUSES }
      },
      select: { startAt: true, endAt: true }
    }),
    db.providerTimeOff.findMany({
      where: {
        providerId: provider.id,
        startAt: { lte: overallEnd },
        endAt: { gte: overallStart }
      },
      select: { startAt: true, endAt: true }
    })
  ]);

  const blockedRanges: TimeRange[] = [
    ...appointments.map((a) => ({ start: a.startAt, end: a.endAt })),
    ...timeOff.map((t) => ({ start: t.startAt, end: t.endAt }))
  ];
  const byWeekday = new Map<number, ProviderSchedule[]>();
  for (const sched of provider.schedules) {
    const entries = byWeekday.get(sched.weekday) ?? [];
    entries.push(sched);
    byWeekday.set(sched.weekday, entries);
  }

  const availability = days.map((date) => {
    const weekday = getWeekdayFromYmd(date);
    const schedules = byWeekday.get(weekday) ?? [];
    const slots: string[] = [];

    for (const sched of schedules) {
      const workStart = zonedLocalTimeToUtcDate(date, sched.startTime, provider.clinic.timezone);
      const workEnd = zonedLocalTimeToUtcDate(date, sched.endTime, provider.clinic.timezone);
      const breaks = parseBreaks(sched).map((bk) => ({
        start: zonedLocalTimeToUtcDate(date, bk.startTime, provider.clinic.timezone),
        end: zonedLocalTimeToUtcDate(date, bk.endTime, provider.clinic.timezone)
      }));

      let cursor = new Date(workStart);
      while (cursor < workEnd) {
        const slotEnd = addMinutes(cursor, slotMinutes);
        if (slotEnd > workEnd) break;

        const slot: TimeRange = { start: cursor, end: slotEnd };
        const hitBreak = breaks.some((br) => overlaps(slot, br));
        const hitBlocked = blockedRanges.some((range) => overlaps(slot, range));

        if (!hitBreak && !hitBlocked) {
          slots.push(slot.start.toISOString());
        }
        cursor = addMinutes(cursor, slotMinutes);
      }
    }

    return { date, slots };
  });

  return {
    providerId: provider.id,
    providerName: provider.name,
    clinicId: provider.clinicId,
    clinicTimezone: provider.clinic.timezone,
    slotMinutes,
    availability
  };
}

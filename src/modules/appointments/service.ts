import { AppointmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN
];

function assertFuture(startAt: Date) {
  if (startAt.getTime() <= Date.now()) {
    throw new Error("Appointment must be in the future");
  }
}

function assertTwoHourCutoff(startAt: Date) {
  const diffMs = startAt.getTime() - Date.now();
  if (diffMs < 2 * 60 * 60 * 1000) {
    throw new Error("Cancellation is not allowed within 2 hours");
  }
}

async function assertProviderAvailable(params: {
  tenantId: string;
  providerId: string;
  clinicId: string;
  startAt: Date;
  endAt: Date;
  excludeAppointmentId?: string;
}) {
  const overlapping = await db.appointment.findFirst({
    where: {
      tenantId: params.tenantId,
      clinicId: params.clinicId,
      providerId: params.providerId,
      status: { in: ACTIVE_STATUSES },
      id: params.excludeAppointmentId ? { not: params.excludeAppointmentId } : undefined,
      startAt: { lt: params.endAt },
      endAt: { gt: params.startAt }
    },
    select: { id: true }
  });
  if (overlapping) {
    throw new Error("Provider is not available for the selected time");
  }

  const timeOffConflict = await db.providerTimeOff.findFirst({
    where: {
      providerId: params.providerId,
      startAt: { lt: params.endAt },
      endAt:   { gt: params.startAt }
    },
    select: { id: true }
  });
  if (timeOffConflict) {
    throw new Error("Provider is not available for the selected time");
  }
}

async function assertPatientRules(params: {
  tenantId: string;
  patientId: string;
  startAt: Date;
  endAt: Date;
  excludeAppointmentId?: string;
}) {
  const overlap = await db.appointment.findFirst({
    where: {
      tenantId: params.tenantId,
      patientId: params.patientId,
      status: { in: ACTIVE_STATUSES },
      id: params.excludeAppointmentId ? { not: params.excludeAppointmentId } : undefined,
      startAt: { lt: params.endAt },
      endAt: { gt: params.startAt }
    },
    select: { id: true }
  });
  if (overlap) throw new Error("Patient already has an overlapping active booking");

  const activeCount = await db.appointment.count({
    where: {
      tenantId: params.tenantId,
      patientId: params.patientId,
      status: { in: ACTIVE_STATUSES },
      id: params.excludeAppointmentId ? { not: params.excludeAppointmentId } : undefined
    }
  });
  if (activeCount >= 1) {
    throw new Error("Patient can only have one active booking");
  }
}

async function writeAuditLog(input: {
  tenantId: string;
  actorId: string;
  entityId: string;
  action: string;
  changes?: Record<string, unknown>;
}) {
  await db.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: "user",
      entityType: "appointment",
      entityId: input.entityId,
      action: input.action,
      changes: (input.changes as any) ?? {}
    }
  });
}

export async function createAppointment(input: {
  tenantId: string;
  actorId: string;
  actorRole: Role;
  clinicId: string;
  providerId: string;
  patientId: string;
  startAt: Date;
  endAt: Date;
  notes?: string;
}) {
  assertFuture(input.startAt);

  const [provider, patient] = await Promise.all([
    db.provider.findFirst({
      where: {
        id: input.providerId,
        clinicId: input.clinicId,
        active: true,
        clinic: { tenantId: input.tenantId, active: true }
      },
      select: { id: true }
    }),
    db.patientProfile.findFirst({
      where: {
        id: input.patientId,
        tenantId: input.tenantId
      },
      select: { id: true }
    })
  ]);

  if (!provider) throw new Error("Provider not found");
  if (!patient) throw new Error("Patient profile not found for this clinic");

  await assertProviderAvailable(input);
  await assertPatientRules(input);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
  const recentCount = await db.appointment.count({
    where: { patientId: input.patientId, createdAt: { gte: tenMinutesAgo } }
  });
  if (recentCount >= 3) throw new Error("Too many booking attempts");

  const appointment = await db.appointment.create({
    data: {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      providerId: input.providerId,
      patientId: input.patientId,
      startAt: input.startAt,
      endAt: input.endAt,
      status: AppointmentStatus.BOOKED,
      source: input.actorRole === Role.RECEPTIONIST ? "reception" : "patient",
      notes: input.notes
    }
  });

  await writeAuditLog({
    tenantId: input.tenantId,
    actorId: input.actorId,
    entityId: appointment.id,
    action: "create",
    changes: {
      clinicId: input.clinicId,
      providerId: input.providerId,
      patientId: input.patientId,
      startAt: input.startAt.toISOString(),
      endAt: input.endAt.toISOString()
    }
  });

  return appointment;
}

export async function rescheduleAppointment(input: {
  tenantId: string;
  actorId: string;
  actorRole: Role;
  actorPatientProfileId?: string | null;
  appointmentId: string;
  startAt: Date;
  endAt: Date;
  providerId?: string;
}) {
  assertFuture(input.startAt);

  const current = await db.appointment.findFirst({
    where: { id: input.appointmentId, tenantId: input.tenantId },
    select: {
      id: true,
      clinicId: true,
      providerId: true,
      patientId: true,
      status: true,
      startAt: true,
      endAt: true
    }
  });
  if (!current) throw new Error("Appointment not found");
  if (input.actorRole === Role.PATIENT && current.patientId !== input.actorPatientProfileId) {
    throw new Error("Forbidden");
  }
  if (!ACTIVE_STATUSES.includes(current.status)) {
    throw new Error("Only active appointments can be rescheduled");
  }

  const targetProviderId = input.providerId ?? current.providerId;
  await assertProviderAvailable({
    tenantId: input.tenantId,
    clinicId: current.clinicId,
    providerId: targetProviderId,
    startAt: input.startAt,
    endAt: input.endAt,
    excludeAppointmentId: current.id
  });
  await assertPatientRules({
    tenantId: input.tenantId,
    patientId: current.patientId,
    startAt: input.startAt,
    endAt: input.endAt,
    excludeAppointmentId: current.id
  });

  const updated = await db.appointment.update({
    where: { id: current.id },
    data: {
      providerId: targetProviderId,
      startAt: input.startAt,
      endAt: input.endAt
    }
  });

  await writeAuditLog({
    tenantId: input.tenantId,
    actorId: input.actorId,
    entityId: updated.id,
    action: "reschedule",
    changes: {
      oldStartAt: current.startAt.toISOString(),
      oldEndAt: current.endAt.toISOString(),
      newStartAt: input.startAt.toISOString(),
      newEndAt: input.endAt.toISOString(),
      oldProviderId: current.providerId,
      newProviderId: targetProviderId
    }
  });

  return updated;
}

export async function cancelAppointment(input: {
  tenantId: string;
  actorId: string;
  actorRole: Role;
  actorPatientProfileId?: string | null;
  appointmentId: string;
}) {
  const current = await db.appointment.findFirst({
    where: { id: input.appointmentId, tenantId: input.tenantId },
    select: {
      id: true,
      status: true,
      startAt: true
    }
  });
  if (!current) throw new Error("Appointment not found");
  if (input.actorRole === Role.PATIENT) {
    const owned = await db.appointment.findFirst({
      where: {
        id: current.id,
        patientId: input.actorPatientProfileId ?? "__none__"
      },
      select: { id: true }
    });
    if (!owned) throw new Error("Forbidden");
  }
  if (!ACTIVE_STATUSES.includes(current.status)) {
    throw new Error("Only active appointments can be cancelled");
  }

  assertTwoHourCutoff(current.startAt);

  const updated = await db.appointment.update({
    where: { id: current.id },
    data: {
      status:
        input.actorRole === Role.RECEPTIONIST
          ? AppointmentStatus.CANCELLED_BY_RECEPTION
          : AppointmentStatus.CANCELLED_BY_PATIENT
    }
  });

  await writeAuditLog({
    tenantId: input.tenantId,
    actorId: input.actorId,
    entityId: updated.id,
    action: "cancel",
    changes: { oldStatus: current.status, newStatus: updated.status }
  });

  return updated;
}

export async function receptionistTransition(input: {
  tenantId: string;
  actorId: string;
  appointmentId: string;
  nextStatus: "CHECKED_IN" | "COMPLETED" | "NO_SHOW";
}) {
  const current = await db.appointment.findFirst({
    where: { id: input.appointmentId, tenantId: input.tenantId },
    select: { id: true, status: true }
  });
  if (!current) throw new Error("Appointment not found");

  const VALID_TRANSITIONS: Record<string, AppointmentStatus[]> = {
    CHECKED_IN: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED],
    COMPLETED:  [AppointmentStatus.CHECKED_IN],
    NO_SHOW:    [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN]
  };
  const allowed = VALID_TRANSITIONS[input.nextStatus] ?? [];
  if (!allowed.includes(current.status)) {
    throw new Error(`Cannot transition from ${current.status} to ${input.nextStatus}`);
  }

  const updated = await db.appointment.update({
    where: { id: current.id },
    data: { status: input.nextStatus }
  });

  await writeAuditLog({
    tenantId: input.tenantId,
    actorId: input.actorId,
    entityId: updated.id,
    action: "status_change",
    changes: { oldStatus: current.status, newStatus: input.nextStatus }
  });

  return updated;
}

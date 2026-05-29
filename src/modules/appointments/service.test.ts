import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAppointment, rescheduleAppointment, cancelAppointment } from "./service";
import { db } from "@/lib/db";
import { AppointmentStatus, Role } from "@prisma/client";

vi.mock("@/lib/db", () => {
  return {
    db: {
      appointment: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      provider: {
        findFirst: vi.fn(),
      },
      patientProfile: {
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    },
  };
});

describe("Appointments Service - Business Rules", () => {
  const mockTenantId = "tenant-1";
  const mockActorId = "actor-1";
  const mockClinicId = "clinic-1";
  const mockProviderId = "provider-1";
  const mockPatientId = "patient-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAppointment", () => {
    it("should prevent creating an appointment in the past", async () => {
      const pastDate = new Date(Date.now() - 60_000);
      const futureDate = new Date(Date.now() + 15 * 60_000);

      await expect(
        createAppointment({
          tenantId: mockTenantId,
          actorId: mockActorId,
          actorRole: Role.PATIENT,
          clinicId: mockClinicId,
          providerId: mockProviderId,
          patientId: mockPatientId,
          startAt: pastDate,
          endAt: futureDate,
        })
      ).rejects.toThrow("Appointment must be in the future");
    });

    it("should throw error if provider is not active or doesn't exist", async () => {
      const startAt = new Date(Date.now() + 60_000 * 30);
      const endAt = new Date(startAt.getTime() + 15 * 60_000);

      vi.mocked(db.provider.findFirst).mockResolvedValue(null); // Provider not found
      vi.mocked(db.patientProfile.findFirst).mockResolvedValue({ id: mockPatientId } as any);

      await expect(
        createAppointment({
          tenantId: mockTenantId,
          actorId: mockActorId,
          actorRole: Role.PATIENT,
          clinicId: mockClinicId,
          providerId: mockProviderId,
          patientId: mockPatientId,
          startAt,
          endAt,
        })
      ).rejects.toThrow("Provider not found");
    });

    it("should prevent booking if patient already has an active booking", async () => {
      const startAt = new Date(Date.now() + 60_000 * 30);
      const endAt = new Date(startAt.getTime() + 15 * 60_000);

      vi.mocked(db.provider.findFirst).mockResolvedValue({ id: mockProviderId } as any);
      vi.mocked(db.patientProfile.findFirst).mockResolvedValue({ id: mockPatientId } as any);

      // Rule: No overlapping active bookings for the patient
      vi.mocked(db.appointment.findFirst).mockResolvedValue(null);
      // Rule: Max 1 active booking count check
      vi.mocked(db.appointment.count).mockResolvedValue(1); // Already has 1 active booking!

      await expect(
        createAppointment({
          tenantId: mockTenantId,
          actorId: mockActorId,
          actorRole: Role.PATIENT,
          clinicId: mockClinicId,
          providerId: mockProviderId,
          patientId: mockPatientId,
          startAt,
          endAt,
        })
      ).rejects.toThrow("Patient can only have one active booking");
    });

    it("should prevent booking if the provider has an overlapping active appointment", async () => {
      const startAt = new Date(Date.now() + 60_000 * 30);
      const endAt = new Date(startAt.getTime() + 15 * 60_000);

      vi.mocked(db.provider.findFirst).mockResolvedValue({ id: mockProviderId } as any);
      vi.mocked(db.patientProfile.findFirst).mockResolvedValue({ id: mockPatientId } as any);

      // Mock provider overlapping appointment check returning a match
      vi.mocked(db.appointment.findFirst).mockResolvedValue({ id: "overlap-apt" } as any);

      await expect(
        createAppointment({
          tenantId: mockTenantId,
          actorId: mockActorId,
          actorRole: Role.PATIENT,
          clinicId: mockClinicId,
          providerId: mockProviderId,
          patientId: mockPatientId,
          startAt,
          endAt,
        })
      ).rejects.toThrow("Provider is not available for the selected time");
    });

    it("should successfully create appointment and write an audit log if all rules pass", async () => {
      const startAt = new Date(Date.now() + 60_000 * 30);
      const endAt = new Date(startAt.getTime() + 15 * 60_000);

      vi.mocked(db.provider.findFirst).mockResolvedValue({ id: mockProviderId } as any);
      vi.mocked(db.patientProfile.findFirst).mockResolvedValue({ id: mockPatientId } as any);

      // No provider overlap, no patient overlap, active bookings = 0
      vi.mocked(db.appointment.findFirst).mockResolvedValue(null);
      vi.mocked(db.appointment.count).mockResolvedValue(0);

      const expectedApt = { id: "apt-1", startAt, endAt, tenantId: mockTenantId } as any;
      vi.mocked(db.appointment.create).mockResolvedValue(expectedApt);

      const result = await createAppointment({
        tenantId: mockTenantId,
        actorId: mockActorId,
        actorRole: Role.PATIENT,
        clinicId: mockClinicId,
        providerId: mockProviderId,
        patientId: mockPatientId,
        startAt,
        endAt,
      });

      expect(result).toBe(expectedApt);
      expect(db.appointment.create).toHaveBeenCalledOnce();
      expect(db.auditLog.create).toHaveBeenCalledOnce();
    });
  });

  describe("cancelAppointment", () => {
    it("should prevent cancellation if the appointment start time is within 2 hours", async () => {
      const nearFuture = new Date(Date.now() + 60_000 * 90); // 1.5 hours in the future (cutoff is 2 hours)

      vi.mocked(db.appointment.findFirst).mockResolvedValue({
        id: "apt-1",
        status: AppointmentStatus.BOOKED,
        startAt: nearFuture,
        patientId: mockPatientId,
      } as any);

      await expect(
        cancelAppointment({
          tenantId: mockTenantId,
          actorId: mockActorId,
          actorRole: Role.PATIENT,
          actorPatientProfileId: mockPatientId,
          appointmentId: "apt-1",
        })
      ).rejects.toThrow("Cancellation is not allowed within 2 hours");
    });

    it("should allow cancellation if the start time is greater than 2 hours away", async () => {
      const farFuture = new Date(Date.now() + 60_000 * 180); // 3 hours in the future

      const mockApt = {
        id: "apt-1",
        status: AppointmentStatus.BOOKED,
        startAt: farFuture,
        patientId: mockPatientId,
      } as any;

      vi.mocked(db.appointment.findFirst).mockResolvedValue(mockApt);
      vi.mocked(db.appointment.update).mockResolvedValue({
        ...mockApt,
        status: AppointmentStatus.CANCELLED_BY_PATIENT,
      });

      const result = await cancelAppointment({
        tenantId: mockTenantId,
        actorId: mockActorId,
        actorRole: Role.PATIENT,
        actorPatientProfileId: mockPatientId,
        appointmentId: "apt-1",
      });

      expect(result.status).toBe(AppointmentStatus.CANCELLED_BY_PATIENT);
      expect(db.appointment.update).toHaveBeenCalledOnce();
      expect(db.auditLog.create).toHaveBeenCalledOnce();
    });
  });
});

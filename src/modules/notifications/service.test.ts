import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendAppointmentReminder } from "./service";
import { db } from "@/lib/db";
import { ReminderChannel, ReminderType, ReminderStatus } from "@prisma/client";

vi.mock("@/lib/db", () => {
  return {
    db: {
      appointment: {
        findUnique: vi.fn(),
      },
      reminderLog: {
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

describe("Notification Service - Reminders and Fallbacks", () => {
  const mockAptId = "apt-123";
  const mockStartAt = new Date("2026-06-01T10:00:00Z");

  const baseAppointment = {
    id: mockAptId,
    tenantId: "tenant-1",
    startAt: mockStartAt,
    clinic: {
      name: "Dental HK",
      timezone: "Asia/Hong_Kong"
    },
    provider: {
      name: "John Doe"
    },
    patient: {
      id: "patient-1",
      fullName: "Jane Patient",
      phoneE164: "+85291234567",
      reminderOptIn: true,
      preferredChan: ReminderChannel.TELEGRAM,
      telegramChatId: "tg-chat-999",
      user: {
        email: "jane@example.com"
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip and log nothing if patient has opted out of reminders", async () => {
    const aptWithOptOut = {
      ...baseAppointment,
      patient: {
        ...baseAppointment.patient,
        reminderOptIn: false
      }
    };

    vi.mocked(db.appointment.findUnique).mockResolvedValue(aptWithOptOut as any);

    const result = await sendAppointmentReminder(mockAptId, ReminderType.T24);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("OPTED_OUT");
    expect(db.reminderLog.create).not.toHaveBeenCalled();
  });

  it("should successfully send via Telegram when it is preferred and Chat ID is configured", async () => {
    vi.mocked(db.appointment.findUnique).mockResolvedValue(baseAppointment as any);
    
    // Mock DB logs
    vi.mocked(db.reminderLog.create).mockResolvedValue({ id: "log-tg-queued" } as any);
    vi.mocked(db.reminderLog.update).mockResolvedValue({ id: "log-tg-sent" } as any);

    const result = await sendAppointmentReminder(mockAptId, ReminderType.T24);

    expect(result.success).toBe(true);
    expect(result.channel).toBe(ReminderChannel.TELEGRAM);
    
    // Asserts DB log creation for Telegram
    expect(db.reminderLog.create).toHaveBeenCalledWith({
      data: {
        appointmentId: mockAptId,
        channel: ReminderChannel.TELEGRAM,
        type: ReminderType.T24,
        status: ReminderStatus.QUEUED
      }
    });
    
    // Asserts DB log update for Telegram status to SENT
    expect(db.reminderLog.update).toHaveBeenCalledWith({
      where: { id: "log-tg-queued" },
      data: expect.objectContaining({
        status: ReminderStatus.SENT,
        providerMessageId: expect.any(String),
        sentAt: expect.any(Date)
      })
    });
  });

  it("should automatically fall back to Email if Telegram is preferred but Chat ID is missing", async () => {
    const aptWithoutTgChat = {
      ...baseAppointment,
      patient: {
        ...baseAppointment.patient,
        telegramChatId: null
      }
    };

    vi.mocked(db.appointment.findUnique).mockResolvedValue(aptWithoutTgChat as any);
    vi.mocked(db.reminderLog.create).mockResolvedValue({ id: "log-queued" } as any);
    vi.mocked(db.reminderLog.update).mockResolvedValue({ id: "log-sent" } as any);

    const result = await sendAppointmentReminder(mockAptId, ReminderType.T24);

    expect(result.success).toBe(true);
    expect(result.channel).toBe(ReminderChannel.EMAIL);

    // 1st Log: Failed Telegram attempt (No Chat ID)
    expect(db.reminderLog.create).toHaveBeenNthCalledWith(1, {
      data: {
        appointmentId: mockAptId,
        channel: ReminderChannel.TELEGRAM,
        type: ReminderType.T24,
        status: ReminderStatus.FAILED,
        errorCode: "NO_CHAT_ID",
        errorMessage: expect.any(String)
      }
    });

    // 2nd Log: Email queued
    expect(db.reminderLog.create).toHaveBeenNthCalledWith(2, {
      data: {
        appointmentId: mockAptId,
        channel: ReminderChannel.EMAIL,
        type: ReminderType.T24,
        status: ReminderStatus.QUEUED
      }
    });

    // Asserts Email was updated to SENT
    expect(db.reminderLog.update).toHaveBeenCalledWith({
      where: { id: "log-queued" },
      data: expect.objectContaining({
        status: ReminderStatus.SENT,
        providerMessageId: expect.any(String),
        sentAt: expect.any(Date)
      })
    });
  });

  it("should attempt WhatsApp, fail if not configured, and fall back to Email", async () => {
    const aptWithWhatsApp = {
      ...baseAppointment,
      patient: {
        ...baseAppointment.patient,
        preferredChan: ReminderChannel.WHATSAPP
      }
    };

    vi.mocked(db.appointment.findUnique).mockResolvedValue(aptWithWhatsApp as any);
    vi.mocked(db.reminderLog.create).mockResolvedValue({ id: "log-queued" } as any);
    vi.mocked(db.reminderLog.update).mockResolvedValue({ id: "log-sent" } as any);

    const result = await sendAppointmentReminder(mockAptId, ReminderType.T2);

    expect(result.success).toBe(true);
    expect(result.channel).toBe(ReminderChannel.EMAIL);

    // Should create a queued WhatsApp log
    expect(db.reminderLog.create).toHaveBeenNthCalledWith(1, {
      data: {
        appointmentId: mockAptId,
        channel: ReminderChannel.WHATSAPP,
        type: ReminderType.T2,
        status: ReminderStatus.QUEUED
      }
    });

    // Should update WhatsApp log to FAILED due to NOT_CONFIGURED
    expect(db.reminderLog.update).toHaveBeenNthCalledWith(1, {
      where: { id: "log-queued" },
      data: {
        status: ReminderStatus.FAILED,
        errorCode: "NOT_CONFIGURED",
        errorMessage: "WhatsApp service credentials missing"
      }
    });

    // Should queue Email fallback
    expect(db.reminderLog.create).toHaveBeenNthCalledWith(2, {
      data: {
        appointmentId: mockAptId,
        channel: ReminderChannel.EMAIL,
        type: ReminderType.T2,
        status: ReminderStatus.QUEUED
      }
    });
  });
});

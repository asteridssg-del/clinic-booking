import { db } from "@/lib/db";
import { ReminderChannel, ReminderType, ReminderStatus } from "@prisma/client";
import { TelegramProvider, EmailProvider, WhatsAppProvider } from "./providers";
import { NotificationPayload } from "./types";

const telegramProvider = new TelegramProvider();
const emailProvider = new EmailProvider();
const whatsAppProvider = new WhatsAppProvider();

export async function sendAppointmentReminder(appointmentId: string, type: ReminderType) {
  // 1. Fetch appointment, patient profile, and linked user
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: {
        include: {
          user: true
        }
      },
      provider: true,
      clinic: true
    }
  });

  if (!appointment) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }

  const { patient } = appointment;
  if (!patient.reminderOptIn) {
    console.log(`[ReminderService] Patient ${patient.fullName} has opted out of reminders. Skipping.`);
    return { success: false, reason: "OPTED_OUT" };
  }

  // 2. Draft the notification message
  const dateStr = appointment.startAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const timeStr = appointment.startAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: appointment.clinic.timezone
  });
  const message = `Hello ${patient.fullName}, this is a reminder for your booking with Dr. ${appointment.provider.name} at ${appointment.clinic.name} on ${dateStr} at ${timeStr}.`;

  const payload: NotificationPayload = {
    recipient: "",
    message,
    metadata: {
      appointmentId: appointment.id,
      tenantId: appointment.tenantId
    }
  };

  const channelPreference = patient.preferredChan;

  // 3. Routing & dispatch logic
  if (channelPreference === ReminderChannel.TELEGRAM) {
    if (patient.telegramChatId) {
      // Attempt Telegram
      const outcome = await dispatchNotification(ReminderChannel.TELEGRAM, patient.telegramChatId, payload, type);
      if (outcome.success) {
        return { success: true, channel: ReminderChannel.TELEGRAM, logId: outcome.logId };
      }
      console.log(`[ReminderService] Telegram failed. Falling back to Email...`);
    } else {
      console.log(`[ReminderService] Patient preferred Telegram but has no telegramChatId. Falling back to Email...`);
      // Log failed Telegram attempt
      await logReminderOutcome({
        appointmentId: appointment.id,
        channel: ReminderChannel.TELEGRAM,
        type,
        status: ReminderStatus.FAILED,
        errorCode: "NO_CHAT_ID",
        errorMessage: "Preferred Telegram but Chat ID is not configured"
      });
    }

    // Fallback to Email
    const email = patient.user?.email || null;
    if (email) {
      const emailOutcome = await dispatchNotification(ReminderChannel.EMAIL, email, payload, type);
      return { success: emailOutcome.success, channel: ReminderChannel.EMAIL, logId: emailOutcome.logId };
    } else {
      console.log(`[ReminderService] Fallback to email failed: No email on file.`);
      await logReminderOutcome({
        appointmentId: appointment.id,
        channel: ReminderChannel.EMAIL,
        type,
        status: ReminderStatus.FAILED,
        errorCode: "NO_EMAIL",
        errorMessage: "No email address found for fallback routing"
      });
      return { success: false, reason: "NO_EMAIL" };
    }
  }

  if (channelPreference === ReminderChannel.WHATSAPP) {
    // Attempt WhatsApp
    const phone = patient.phoneE164;
    const outcome = await dispatchNotification(ReminderChannel.WHATSAPP, phone, payload, type);
    if (outcome.success) {
      return { success: true, channel: ReminderChannel.WHATSAPP, logId: outcome.logId };
    }
    
    console.log(`[ReminderService] WhatsApp failed (Code: ${outcome.error}). Falling back to Email...`);
    
    // Fallback to Email
    const email = patient.user?.email || null;
    if (email) {
      const emailOutcome = await dispatchNotification(ReminderChannel.EMAIL, email, payload, type);
      return { success: emailOutcome.success, channel: ReminderChannel.EMAIL, logId: emailOutcome.logId };
    } else {
      await logReminderOutcome({
        appointmentId: appointment.id,
        channel: ReminderChannel.EMAIL,
        type,
        status: ReminderStatus.FAILED,
        errorCode: "NO_EMAIL",
        errorMessage: "No email address found for fallback routing"
      });
      return { success: false, reason: "NO_EMAIL" };
    }
  }

  // Default / Preferred channel is EMAIL
  const email = patient.user?.email || null;
  if (email) {
    const outcome = await dispatchNotification(ReminderChannel.EMAIL, email, payload, type);
    return { success: outcome.success, channel: ReminderChannel.EMAIL, logId: outcome.logId };
  } else {
    console.log(`[ReminderService] Preferred Email but has no email address.`);
    await logReminderOutcome({
      appointmentId: appointment.id,
      channel: ReminderChannel.EMAIL,
      type,
      status: ReminderStatus.FAILED,
      errorCode: "NO_EMAIL",
      errorMessage: "Preferred Email but no email address is configured"
    });
    return { success: false, reason: "NO_EMAIL" };
  }
}

/**
 * Dispatch notification through the appropriate channel, logging states to Database
 */
async function dispatchNotification(
  channel: ReminderChannel,
  recipient: string,
  payload: NotificationPayload,
  type: ReminderType
): Promise<{ success: boolean; logId: string; error?: string }> {
  // Create Initial Log in Database
  const log = await db.reminderLog.create({
    data: {
      appointmentId: payload.metadata!.appointmentId!,
      channel,
      type,
      status: ReminderStatus.QUEUED
    }
  });

  const providerPayload = { ...payload, recipient };
  let response;

  if (channel === ReminderChannel.TELEGRAM) {
    response = await telegramProvider.send(providerPayload);
  } else if (channel === ReminderChannel.EMAIL) {
    response = await emailProvider.send(providerPayload);
  } else {
    response = await whatsAppProvider.send(providerPayload);
  }

  if (response.success) {
    await db.reminderLog.update({
      where: { id: log.id },
      data: {
        status: ReminderStatus.SENT,
        providerMessageId: response.messageId,
        sentAt: new Date()
      }
    });
    return { success: true, logId: log.id };
  } else {
    await db.reminderLog.update({
      where: { id: log.id },
      data: {
        status: ReminderStatus.FAILED,
        errorCode: response.error,
        errorMessage: response.error === "NOT_CONFIGURED" ? "WhatsApp service credentials missing" : "Provider dispatch error"
      }
    });
    return { success: false, logId: log.id, error: response.error };
  }
}

/**
 * Helper to log failed notifications directly
 */
async function logReminderOutcome(params: {
  appointmentId: string;
  channel: ReminderChannel;
  type: ReminderType;
  status: ReminderStatus;
  errorCode: string;
  errorMessage: string;
}) {
  return db.reminderLog.create({
    data: {
      appointmentId: params.appointmentId,
      channel: params.channel,
      type: params.type,
      status: params.status,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage
    }
  });
}

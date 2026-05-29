import { db } from "@/lib/db";
import { ReminderChannel, ReminderType, ReminderStatus } from "@prisma/client";
import { TelegramProvider, EmailProvider, WhatsAppProvider } from "./providers";
import { NotificationPayload } from "./types";

const telegramProvider = new TelegramProvider();
const emailProvider = new EmailProvider();
const whatsAppProvider = new WhatsAppProvider();

type AppointmentWithContext = Awaited<ReturnType<typeof fetchAppointmentWithContext>>;

async function fetchAppointmentWithContext(appointmentId: string) {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
      provider: true,
      clinic: true
    }
  });
  if (!appointment) throw new Error(`Appointment ${appointmentId} not found`);
  return appointment;
}

async function routeAndDispatch(
  appointment: AppointmentWithContext,
  type: ReminderType,
  message: string
): Promise<{ success: boolean; channel?: ReminderChannel; logId?: string; reason?: string }> {
  const { patient } = appointment;
  const payload: NotificationPayload = {
    recipient: "",
    message,
    metadata: { appointmentId: appointment.id, tenantId: appointment.tenantId }
  };

  const channel = patient.preferredChan;

  if (channel === ReminderChannel.TELEGRAM) {
    if (patient.telegramChatId) {
      const outcome = await dispatchNotification(ReminderChannel.TELEGRAM, patient.telegramChatId, payload, type);
      if (outcome.success) return { success: true, channel: ReminderChannel.TELEGRAM, logId: outcome.logId };
      console.log(`[ReminderService] Telegram failed. Falling back to Email...`);
    } else {
      console.log(`[ReminderService] Patient preferred Telegram but has no telegramChatId. Falling back to Email...`);
      await logReminderOutcome({
        appointmentId: appointment.id, channel: ReminderChannel.TELEGRAM, type,
        status: ReminderStatus.FAILED, errorCode: "NO_CHAT_ID",
        errorMessage: "Preferred Telegram but Chat ID is not configured"
      });
    }
    const email = patient.user?.email ?? null;
    if (email) {
      const outcome = await dispatchNotification(ReminderChannel.EMAIL, email, payload, type);
      return { success: outcome.success, channel: ReminderChannel.EMAIL, logId: outcome.logId };
    }
    await logReminderOutcome({
      appointmentId: appointment.id, channel: ReminderChannel.EMAIL, type,
      status: ReminderStatus.FAILED, errorCode: "NO_EMAIL",
      errorMessage: "No email address found for fallback routing"
    });
    return { success: false, reason: "NO_EMAIL" };
  }

  if (channel === ReminderChannel.WHATSAPP) {
    const outcome = await dispatchNotification(ReminderChannel.WHATSAPP, patient.phoneE164, payload, type);
    if (outcome.success) return { success: true, channel: ReminderChannel.WHATSAPP, logId: outcome.logId };
    console.log(`[ReminderService] WhatsApp failed (Code: ${outcome.error}). Falling back to Email...`);
    const email = patient.user?.email ?? null;
    if (email) {
      const outcome2 = await dispatchNotification(ReminderChannel.EMAIL, email, payload, type);
      return { success: outcome2.success, channel: ReminderChannel.EMAIL, logId: outcome2.logId };
    }
    await logReminderOutcome({
      appointmentId: appointment.id, channel: ReminderChannel.EMAIL, type,
      status: ReminderStatus.FAILED, errorCode: "NO_EMAIL",
      errorMessage: "No email address found for fallback routing"
    });
    return { success: false, reason: "NO_EMAIL" };
  }

  // Default: EMAIL
  const email = patient.user?.email ?? null;
  if (email) {
    const outcome = await dispatchNotification(ReminderChannel.EMAIL, email, payload, type);
    return { success: outcome.success, channel: ReminderChannel.EMAIL, logId: outcome.logId };
  }
  console.log(`[ReminderService] Preferred Email but has no email address.`);
  await logReminderOutcome({
    appointmentId: appointment.id, channel: ReminderChannel.EMAIL, type,
    status: ReminderStatus.FAILED, errorCode: "NO_EMAIL",
    errorMessage: "Preferred Email but no email address is configured"
  });
  return { success: false, reason: "NO_EMAIL" };
}

export async function sendAppointmentReminder(appointmentId: string, type: ReminderType) {
  const appointment = await fetchAppointmentWithContext(appointmentId);
  const { patient } = appointment;

  if (!patient.reminderOptIn) {
    console.log(`[ReminderService] Patient ${patient.fullName} has opted out of reminders. Skipping.`);
    return { success: false, reason: "OPTED_OUT" };
  }

  const dateStr = appointment.startAt.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  const timeStr = appointment.startAt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: appointment.clinic.timezone
  });
  const message = `Hello ${patient.fullName}, this is a reminder for your booking with ${appointment.provider.name} at ${appointment.clinic.name} on ${dateStr} at ${timeStr}.`;

  return routeAndDispatch(appointment, type, message);
}

export async function sendBookingConfirmation(appointmentId: string) {
  const appointment = await fetchAppointmentWithContext(appointmentId);
  const { patient } = appointment;

  if (!patient.reminderOptIn) return { success: false, reason: "OPTED_OUT" };

  const dateStr = appointment.startAt.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  const timeStr = appointment.startAt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: appointment.clinic.timezone
  });
  const ref = appointment.id.slice(-6).toUpperCase();
  const message = `Booking confirmed! Your appointment with ${appointment.provider.name} at ${appointment.clinic.name} on ${dateStr} at ${timeStr} is confirmed. Ref: #${ref}.`;

  return routeAndDispatch(appointment, ReminderType.CONFIRMATION, message);
}

async function dispatchNotification(
  channel: ReminderChannel,
  recipient: string,
  payload: NotificationPayload,
  type: ReminderType
): Promise<{ success: boolean; logId: string; error?: string }> {
  const log = await db.reminderLog.create({
    data: { appointmentId: payload.metadata!.appointmentId!, channel, type, status: ReminderStatus.QUEUED }
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
      data: { status: ReminderStatus.SENT, providerMessageId: response.messageId, sentAt: new Date() }
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

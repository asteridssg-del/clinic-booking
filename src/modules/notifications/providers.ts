import { Resend } from "resend";
import { ReminderChannel } from "@prisma/client";
import { NotificationProvider, NotificationPayload, NotificationResponse } from "./types";

export class TelegramProvider implements NotificationProvider {
  channel = ReminderChannel.TELEGRAM;

  async send(payload: NotificationPayload): Promise<NotificationResponse> {
    console.log(`[TelegramProvider] Sending reminder to Chat ID ${payload.recipient}: "${payload.message}"`);
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      // Simulate success for local testing when bot token is absent
      return {
        success: true,
        messageId: `sim-tg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: payload.recipient,
          text: payload.message
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ description: `HTTP ${response.status}` }));
        return {
          success: false,
          error: errorData.description || `HTTP error ${response.status}`
        };
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.result?.message_id?.toString() || `tg-${Date.now()}`
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message
      };
    }
  }
}

export class EmailProvider implements NotificationProvider {
  channel = ReminderChannel.EMAIL;

  async send(payload: NotificationPayload): Promise<NotificationResponse> {
    console.log(`[EmailProvider] Sending email to ${payload.recipient}: "${payload.message}"`);

    if (!process.env.RESEND_API_KEY) {
      return {
        success: true,
        messageId: `sim-email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      };
    }

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { data, error } = await resend.emails.send({
        from:    process.env.RESEND_FROM_EMAIL ?? "Clinic Booking <onboarding@resend.dev>",
        to:      [payload.recipient],
        subject: "Clinic Booking — Appointment Update",
        text:    payload.message
      });
      if (error) return { success: false, error: error.message };
      return { success: true, messageId: data?.id };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

export class WhatsAppProvider implements NotificationProvider {
  channel = ReminderChannel.WHATSAPP;

  async send(payload: NotificationPayload): Promise<NotificationResponse> {
    console.log(`[WhatsAppProvider] Twilio WhatsApp stub triggered for recipient ${payload.recipient}`);
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !fromPhone) {
      return {
        success: false,
        error: "NOT_CONFIGURED"
      };
    }

    // Return success for configured stub
    return {
      success: true,
      messageId: `sim-wa-${Date.now()}`
    };
  }
}

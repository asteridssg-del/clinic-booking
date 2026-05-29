import { ReminderChannel } from "@prisma/client";

export interface NotificationPayload {
  recipient: string; // phone number, email address, or telegram chat ID
  message: string;
  metadata?: {
    appointmentId?: string;
    tenantId?: string;
  };
}

export interface NotificationResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NotificationProvider {
  channel: ReminderChannel;
  send(payload: NotificationPayload): Promise<NotificationResponse>;
}

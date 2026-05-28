# Final Build Prompt

Build a production-minded MVP for a white-label clinic booking web app using:
- Next.js (App Router, TypeScript)
- Supabase Postgres + Prisma
- NextAuth Google login
- Vercel deployment target

## Product Scope

Create one codebase that supports two tenants:
1. Dental clinic in Hong Kong
2. Physio clinic in Kuala Lumpur

Roles:
- Patient
- Receptionist

Constraints:
- Patients must pick a specific doctor first
- Maximum 1 active booking per patient
- Slot interval is 15 minutes
- Cancellation cutoff is 2 hours before appointment
- Timezone is tenant/clinic-specific
- Reminder channels: Telegram primary, email fallback
- Keep WhatsApp/Twilio integration as a pluggable stub for future implementation
- Google Calendar integration first

## Architecture Requirements

- Single Next.js app with:
  - `src/app` for UI and route handlers
  - `src/modules/*` for domain logic
  - `src/lib/*` for infrastructure clients (db/auth/notifications)
- Multi-tenancy by `tenant_id` in all business tables
- Strict authorization checks for tenant isolation
- Mobile-first responsive patient pages

## Data Model Requirements

Define Prisma schema for at least:
- Tenant
- Clinic
- User (role: patient/receptionist)
- PatientProfile (google_sub unique, tenant+phone unique)
- Provider (doctor)
- ProviderSchedule
- ProviderTimeOff
- Appointment
- ReminderLog
- NotificationChannelBinding (telegram chat id, email flags)
- AuditLog

## API/Behavior Requirements

Implement:
- Google auth
- Doctor list and doctor availability endpoint
- Booking endpoint with validation:
  - one active booking per patient
  - no provider overlap
  - booking in allowed schedule only
- Reschedule and cancel endpoint with 2-hour cutoff
- Receptionist check-in/no-show/complete actions
- Reminder scheduler interface and Telegram provider
- Email fallback provider interface
- Twilio WhatsApp provider stub with NOT_CONFIGURED return when env absent

## Non-functional Requirements

- Add input validation (zod)
- Add basic audit logging on booking mutations
- Add structured error responses
- Add unit tests for booking rule: one active booking max
- Add README setup with environment variables and local run steps

## Output Expectations

Deliver incremental commits or PR-sized chunks:
1. Foundation + schema
2. Booking engine + APIs
3. Notifications + reminders
4. Responsive patient/receptionist flows

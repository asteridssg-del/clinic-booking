# Clinic Booking (White-Label) MVP

Multi-tenant clinic booking app for:
- Dental clinic (Hong Kong)
- Physio clinic (Kuala Lumpur, Malaysia)

## Confirmed Product Decisions

- One codebase, multi-tenant
- Patient + receptionist roles only
- Google login for both roles
- Patients pick a specific doctor first
- 1 active booking max per patient
- 15-minute slot interval
- Cancellation cutoff: no cancel under 2 hours
- Timezone per clinic
- Reminder channels: Telegram first, email fallback
- Google Calendar sync first

## Recommended Architecture

- Monorepo-style single Next.js app:
  - App Router UI (`src/app`) for patient and receptionist views
  - Route Handlers (`src/app/api`) for API endpoints
  - Shared domain/services in `src/modules`
- Data and auth:
  - Supabase Postgres
  - Prisma ORM
  - NextAuth (Google provider)
- Jobs:
  - DB-driven scheduled reminders first
  - Optional Redis queue later for higher scale/retries

This architecture is fastest for MVP while staying production-upgradable.

## Patient Identity Rule Recommendation

Use both constraints:
- Global unique Google account identity (`google_sub` unique)
- Tenant-scoped phone uniqueness (`tenant_id + phone_e164` unique)

Reason: prevents accidental duplicate patient records per clinic while allowing one person to use different numbers across different clinics if needed.

## Initial Project Structure

See `docs/build-prompt.md` and `docs/day-1-plan.md` for implementation scope.

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in credentials.
2. Install packages:
   - `npm install`
3. Generate Prisma client and run first migration:
   - `npm run prisma:generate`
   - `npm run prisma:migrate -- --name init`
4. Start dev server:
   - `npm run dev`

## Auth and Session Shape

- Google login route: `/api/auth/signin`
- Session exposes:
  - `session.user.id`
  - `session.user.tenantId`
  - `session.user.role`
- Test endpoint:
  - `GET /api/me`

## Availability API (Doctor-first)

- `GET /api/v1/providers/{providerId}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Optional: `slotMinutes` (default 15)
- Returns available slot start times as ISO timestamps in UTC.

## Appointment APIs (MVP)

- `POST /api/v1/appointments`
- `PATCH /api/v1/appointments/{appointmentId}/reschedule`
- `POST /api/v1/appointments/{appointmentId}/cancel`
- `POST /api/v1/appointments/{appointmentId}/checkin` (receptionist)
- `POST /api/v1/appointments/{appointmentId}/complete` (receptionist)
- `POST /api/v1/appointments/{appointmentId}/no-show` (receptionist)

Rules enforced:
- One active booking max per patient
- No provider overlap in active statuses
- No patient overlap in active statuses
- Cancellation blocked within 2 hours of start time

# Day-1 Coding Plan

## Goal

Stand up the technical foundation and implement the first booking-critical path.

## Milestone 1: Project and Infra Setup (1-2 hours)

- Install dependencies
- Configure Next.js + TypeScript baseline
- Add Prisma and initial schema skeleton
- Configure Supabase connection variables
- Add lint/typecheck scripts

Done when:
- `npm run typecheck` passes
- Prisma client generates successfully

## Milestone 2: Multi-tenant Auth Foundation (2-3 hours)

- Configure NextAuth Google provider
- Create user bootstrap on first login
- Add role model (patient/receptionist)
- Add tenant mapping for users
- Add route protection helpers

Done when:
- User can sign in with Google
- Session exposes `userId`, `tenantId`, and `role`

## Milestone 3: Doctor-First Availability (2-3 hours)

- Add provider schedule/time-off schema
- Implement availability calculation service (15-minute intervals)
- Add endpoint: get availability by doctor and date range

Done when:
- Endpoint returns deterministic slots in clinic timezone

## Milestone 4: Booking API with Hard Rules (3-4 hours)

- Implement create appointment endpoint
- Enforce:
  - one active booking per patient
  - no provider overlap
  - slot validity against schedule
- Add cancel/reschedule with 2-hour cutoff
- Write audit log entries for each mutation

Done when:
- Tests cover one-active-booking rule and cutoff behavior

## Milestone 5: Notification Abstraction (1-2 hours)

- Create notification provider interface
- Implement Telegram provider skeleton
- Implement email fallback skeleton
- Add Twilio WhatsApp provider stub (not enabled)

Done when:
- Reminder service can select channel order and return logged outcomes

## Deliverables by End of Day 1

- Running app shell
- Auth flow working
- Availability endpoint working
- Booking/cancel/reschedule APIs with core constraints
- Notification abstraction ready for Telegram-first reminders

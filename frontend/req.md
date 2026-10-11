# Frontend Requirements

## Users

IT/admin staff only. No login required.

## Modules

- Trade Confirmation
- Portfolio
- BO Registration
- Deposit
- Deposit Requisition
- Payment

Disabled modules remain visible. Available operations depend on backend route discovery.

## Trade Confirmation Actions

- Search reports by investor code and date.
- Search across all dates.
- Preview and open/download PDFs.
- Copy report links.
- Generate URLs for a schedule.
- Generate a URL for one investor.
- Copy today's PDFs.
- Send individual email notifications.
- Send individual mobile notifications.
- Send individual mobile and email notifications.
- Bulk send email, mobile, or both.
- Stop bulk sending after the current investor.
- Export report lists and bulk-send results.

## Portfolio Actions

- Search reports by investor code and date.
- Search across all dates.
- Preview and open/download PDFs.
- Copy report links.
- Copy today's portfolio PDFs.
- Send individual and bulk email/mobile notifications.
- Export report lists and bulk-send results.

Portfolio uses the shared URL mapping. Its backend does not expose a separate URL-generation endpoint.

## Mobile Notifications

Use the existing backend mobile chain:
WhatsApp first, then SMS fallback.

Independent SMS-only and WhatsApp-only actions require backend support.

## Logs

Show recorded events from all modules through the shared audit endpoint.

Filters:
- Date
- Investor code
- Module
- Event category

Support pagination and CSV export.

## Daily Report

Show:
- Total sent events
- WhatsApp sent events
- SMS sent events
- Email sent events
- Error events
- Sent/error totals by module
- Event details

Counts represent audit events, not unique investors or verified recipient delivery.

## Bulk Sending

Deduplicate investors across all loaded rows.

Execute requests sequentially.

Show progress and per-investor results.

Continue after individual errors.

Do not automatically retry failed sends.

Combined-channel failures may include partial delivery.

Backend sends resolve each investor's latest URL mapping.

## Configuration

Use environment variables for:
- API base URL
- Document base URL
- Environment label
- Default schedule ID

Support separate UAT and Live builds.

## Backend Boundaries

Backend files remain unchanged.

Only Trade Confirmation and Portfolio expose manual sends.

Other modules expose logs and reporting in this frontend.

Job status is read-only.

Trade/portfolio recipients are determined by the backend, including configured test contacts.

Deposit Requisition currently has no registered PDF route.

Audit totals include only successfully recorded audit events.

Unprefixed document events are attributed to Trade Confirmation.

Deposit Requisition uses RECEIPT_ as its PDF audit prefix, so future PDF events cannot be separated from Deposit without backend changes.
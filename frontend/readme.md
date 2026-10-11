# Statement Sender Frontend

React/Vite frontend for IT/admin operations.

## Setup

Use Node.js 20.19+ or 22.12+ compatible with Vite 7.

```bash
npm install
```

Create .env.local for development.

```dotenv
VITE_API_BASE=http://localhost:4000
VITE_DOCUMENT_BASE=http://localhost:4000
VITE_ENV_LABEL=LOCAL
VITE_SCHEDULE_ID=2
```

API and document bases must be origins without the /api suffix.

```bash
npm run dev
```

## UAT

Copy .env.uat.example to .env.uat.local.

Replace the example URLs with your actual UAT origins.

```bash
npm run build:uat
```

Deploy the generated dist folder to UAT.

## Live

Copy .env.production.example to .env.production.local.

Replace the example URLs with your actual Live origins.

```bash
npm run build:live
```

Deploy the generated dist folder to Live.

Both builds write to dist. Deploy each build to its intended environment before creating the other build.

Vite environment variables are embedded at build time.

Do not store secrets in VITE_ variables.

## Actions

Trade Confirmation:
- Generate schedule URLs.
- Generate one investor URL.
- Copy today's PDFs.
- Individual and bulk notifications.

Portfolio:
- Copy today's portfolio PDFs.
- Individual and bulk notifications.

Mobile notifications use WhatsApp with SMS fallback.

Bulk sends target all loaded rows across pagination and remove duplicate investor codes.

Notifications resolve the latest backend URL mapping.

Stop controls take effect after the current investor finishes.

Failed sends are not retried automatically.

## Logs and Daily Reports

Load a date to retrieve audit events.

Filter by investor, module, or event category.

Export loaded records as CSV.

Daily reports count recorded sends and errors.

Counts do not represent unique investors or confirmed recipient delivery.

## IIS

Keep the existing public/web.config API proxy and React fallback.

Verify the proxy target matches the Node backend.

For same-origin deployment, API requests must reach Node before the React fallback.

For separate API origins, verify HTTPS and backend CORS.

## Validation

```bash
npm run build:uat
npm run build:live
```

Verify against UAT:
- API route discovery.
- Report filtering.
- PDF preview.
- URL generation.
- PDF copying.
- Test-recipient notifications.
- Bulk progress and stopping.
- Error reporting.
- Daily totals.
- CSV exports.
- Direct page refresh under IIS.

## Limitations

Backend remains unchanged.

Manual sends are limited to Trade Confirmation and Portfolio.

Other modules have logs/reporting pages without invented report-list endpoints.

Trade/portfolio recipients currently use backend-configured test contacts.

Separate SMS-only or WhatsApp-only sends require backend endpoints.

Deposit Requisition currently has no registered PDF route.

Audit reporting includes recorded events only.

## Applying Changes

Copy the modified and new files into the existing repository.

Preserve your actual environment files.

Install dependencies and rebuild.

See req.md and design.md for requirements and API mappings.
# City Brokerage – messaging + PDF link service

Investor gets a **WhatsApp (SMS fallback) and an email** with a **link**. The link is an API route that shows a PDF.

## Folder structure

```
src/
  server.js                 start (ENABLE_JOBS=true starts the sync jobs)
  app.js                    express app (routes come from the registry)
  bootstrap/
    context.js              builds shared services: audit, MessageCenter, channel chains
    modules.js              *** THE ONE PLACE where modules are plugged in ***
  config/                   env.js, database.js, paths.js, messageTemplates.json
  core/                     base classes (no business rules)
    BaseModule.js             type + link + routes + optional job
    PdfDocumentModule.js      link -> validate -> resolve() -> renderPdf() -> audit -> send   (written once)
    NotificationRepository.js shared SQL: unsent rows, markSent, markFailed, url codes
    NotificationJob.js        sync source -> send WhatsApp/SMS + email -> mark          (written once)
    ModuleRegistry.js         mounts routes, starts jobs, /api/jobs/status, POST /api/jobs/:type/run
    PdfDiskCache.js  Db.js  errors.js
  channels/                 Channel (base), WhatsAppChannel, SmsChannel, EmailChannel
  services/                 MessageCenter (template + channel chain + audit), AuditService
  modules/
    folderPdf/              shared by trade confirmation + portfolio (PDF already in a folder)
    tradeConfirmation/      = FolderPdfModule + folder settings
    portfolio/              = FolderPdfModule + other folder settings
    receipt/                shared by deposit + payment (receipt PDF from a table)
    deposit/                = ReceiptModule + cheque query
    payment/                = ReceiptModule + payment query   (EXAMPLE, not registered yet)
    boRegistration/         BO step-9 sync + application PDF
  utils/                    phone, urlCode, htmlError, uaParser
```

## How it fits together

| Class | Role |
|---|---|
| `MessageCenter.send({ type, via, recipient, data })` | builds text from `messageTemplates.json`; `via: 'MOBILE'` = WhatsApp 1x then SMS max 3x; `via: 'EMAIL'` = email; writes the audit log |
| `PdfDocumentModule` | all HTTP/audit logic of a PDF link. A subclass writes only `resolve(code)` and `renderPdf(record)` |
| `NotificationJob` + `NotificationRepository` | copy new rows -> url code -> send -> `IsSentSms` / `IsSentEmail` flags, retries (max 5) |

## Add a new module

### A) Another folder of PDFs (same as Portfolio)
Copy `modules/portfolio/index.js`, change `type`, `linkTemplate`, `pdfRoutes`, `adminPrefix`, `notifyRoute` and the folder/prefix. Add a template to `messageTemplates.json`. Register it.

### B) Another receipt from another table (same as Payment)
1. `modules/payment/PaymentRepository.js` – write **only** `fetchNewFromSource()` (keep the column aliases).
2. `modules/payment/index.js` – `type`, `linkTemplate`, `pdfRoutes`, `tranType`.
3. Add `"PAYMENT": { text, email }` to `config/messageTemplates.json` (already there).
4. `bootstrap/modules.js`: uncomment the two Payment lines.

Tables `Payments_Sync` and `PaymentNotification` are created automatically at job start.

### C) A new kind of document
Extend `PdfDocumentModule` (implement `resolve`, `renderPdf`), and if it needs a sync + send job extend `NotificationJob` (implement `syncSource`, `buildRecipient`, `buildData`) with a `NotificationRepository` subclass (write `ddl()`).

### New channel (Telegram, push ...)
Extend `channels/Channel.js` (`accepts`, `send`), add it to a chain in `bootstrap/context.js`.

## Links kept (messages already sent keep working)
`/api/report/pdf?BOID=` (trade confirmation) · `/api/report/receipt/id=CODE` · `/api/bo/reg/report/pdf?BOID=` · `/api/send?code=` · `/api/mail/trade-confirmation?code=` · `/api/report/{resolve-code,audit-logs,portfolio-urls,copy-pdfs}` · `/api/portfoliomap/generate` · `/api/bo-registrations/:id/application`

New: `/api/report/portfolio?BOID=` · `/api/notify/<type>?code=X&via=mobile|email|all` · `/api/portfolio/*` · `/api/jobs/status` · `POST /api/jobs/<TYPE>/run`

## .env
Existing keys unchanged. New (all optional):
```
ENABLE_JOBS=true                # start the sync + notify jobs
PORTFOLIO_PDF_SHARE=\\server\portfolio   # default: NETWORK_PDF_SHARE
PORTFOLIO_FILE_PREFIX=Portfolio_
NOTIFY_EMAIL_ENABLED=true       # false = WhatsApp/SMS only
NOTIFY_TEST_MOBILE=             # TEST ONLY, leave empty in production
NOTIFY_TEST_EMAIL=              # TEST ONLY
SMS_MAX_ATTEMPTS=3  SMS_RETRY_DELAY_MS=1000
```
Dependencies: `express cors axios mssql dotenv jspdf jspdf-autotable sharp`

## Old file -> new file
`messagingService / SmsService / whatsappService / mailService / EmailService / Messagecenter / tradeConfirmationService / smsController / mailController` -> `channels/*` + `services/MessageCenter.js` + `FolderPdfModule.sendByCode`
`PdfController / PdfFileService / PdfBatchCopyService / ReportController / PortfolioMapController / PortfolioMapService / PortfolioMap.model / EmailLog.model` -> `modules/folderPdf/*`
`Deposit/*` -> `modules/receipt/*` + `modules/deposit/*`
`BoApplication/*` -> `modules/boRegistration/*`
`routes/*` -> each module's `routes()`
`auditService / AuditLog.model` -> `services/AuditService.js`, `models/AuditLog.model.js`
Delete the old files after you switch.

## Where are the routes?
There is no `routes/` folder any more. Each module declares its own routes in its class (`routes()`),
and `core/ModuleRegistry.js` mounts them under `/api`.
- Trade confirmation: `modules/tradeConfirmation/index.js`  (`pdfRoutes`, `adminPrefix`, `notifyRoute`, `legacy`)
- Portfolio: `modules/portfolio/index.js` · Deposit: `modules/deposit/index.js` · BO: `modules/boRegistration/index.js`
- See all of them: printed at server start, or `GET /api/routes`.

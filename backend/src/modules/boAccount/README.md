# Unified BO notifications

This increment is based on remote main beb33d7. It integrates account discovery into the existing BO_REGISTRATION job; no second account-opening sender runs in the scheduler. Existing deposit, payment, trade confirmation and portfolio modules are unchanged.

## Two workflows

1. Step 9 keeps its current source query, local BoStepNotification rows, URLs and delivery ledger identity. BO_MOBILE_FIRST chooses SMS or WhatsApp. BO_WHATSAPP_ENABLED, BO_SMS_ENABLED and BO_EMAIL_ENABLED choose available personal channels.
2. Approved accounts are discovered from XBpoolPromise.dbo.Setup_tblInvestor where ApprovedDate meets BO_ACCOUNT_NOTIFY_SINCE and BOID and virtualbankaccountNo are populated. Discovery never sends account-opening messages. IT previews selected accounts in /bo/accounts and explicitly sends.

The central pipeline still synchronizes all due modules before sending pending step-9 notifications and waits its configured interval after completing a cycle. The BO job reports submission and account discovery separately. An account discovery failure does not suppress the original submission stage.

## Database mappings

- XBpoolPromise: Setup_tblInvestor.InvestorCode, InvestorName, boid, virtualbankaccountNo, CellNo, Email, TraderID, ApprovedDate.
- BOpoolPromise: Investor_tblBORegistrationMaster.CustomCode matches InvestorCode; BORegistrationMasterID joins Investor_tblBOInvestorBOOpen; isReferBO=1 identifies a referral; ReferBO matches AgentInfo.refcode. BORegistrationNo is the registration reference.
- poolPromise: rm_info.RMID matches XB TraderID; RMNAME, mobile, email; isActive=1 required.
- poolPromise: AgentInfo.refcode, name, mobile, email; refcode=city is the default City Bank destination.
- There is no SQL cross-server join: records are matched in Node after parameterized queries.

Agent and RM contact directories are matched to accounts in the configured approved-date range. Conflicting investor/registration/RM/agent mappings stop discovery instead of choosing an arbitrary recipient.

## Recipient rules

| Role | Channels | Condition |
| --- | --- | --- |
| Applicant | Configured personal mobile order plus email | Acknowledgement file, active RM details, valid contact and 13-digit VA |
| RM | WhatsApp only | Active RM assigned to investor |
| Agent | WhatsApp plus email when enabled | Referral and matching AgentInfo contact |
| City Bank | WhatsApp plus email when enabled | Referral and agent found; matching city contact |

RM, Agent and Bank never fall back to SMS. They are individual contact destinations from the uploaded specification, not WhatsApp groups. Disable their explicit role flags to suppress them. BO_ACCOUNT_WHATSAPP_ENABLED controls applicant WhatsApp only; internal WhatsApp roles have their own switches. A missing agent holds both Agent and City Bank while allowing the investor and RM to proceed. Missing or invalid information produces per-recipient Needs attention statuses.

## PDF mapping

The application creates poolPromise.dbo.BOAccountNotification. It stores the immutable identity (InvestorCode, BOID), ApprovedDate, a random 48-character URLCode and a JSON contact snapshot. The unique investor/BO constraint makes repeated discovery idempotent. Until dispatch starts, discovery refreshes the snapshot and preserves URLCode. After dispatch, the snapshot and initial DispatchAt are frozen.

Copy an actual PDF to backend/storage/pdf/bo/2311.pdf for InvestorCode 2311. BO_ACK_PDF_DIR is resolved relative to backend, regardless of process working directory. There is no PDF generation or upload in this increment. The system serves a file already supplied by your CDBL process.

Public link: /api/BOACK?BOID=<random URLCode>. Only mapped alphanumeric investor filenames can be used; arbitrary paths cannot be requested. Links do not reveal the account code. Files are served inline with no-store headers. Keep a PDF immutable once its link is distributed; replacing 2311.pdf replaces what the same link serves. Versioned acknowledgements are outside this increment.

## Configuration and rollout

Merge the adjacent .env.example keys into the actual backend .env. Preserve existing database, provider, URL and cutoff configuration. Set BO_ACCOUNT_ENABLED=true to activate discovery/routes. Keep CITYAGENT_ENABLED=false. Startup rejects both flags being true; do not run the old CityAgent sender in a separate process against the same accounts.

The acknowledgement URL uses the existing env.app.statementsBaseUrl. Confirm STATEMENTS_BASE_URL is the actual public domain and protocol. Global NOTIFY_TEST_MOBILE and NOTIFY_TEST_EMAIL still apply when the scoped BO_TEST_* or BO_ACCOUNT_TEST_* variables are blank. For UAT set both scoped mobile and email test destinations. Confirm effective destinations before production rollout.

BO_ACCOUNT_NOTIFY_SINCE is compared with XB ApprovedDate as SQL wall-clock time. Rendered submission messages use the current Asia/Dhaka send time. Account message send time is generated in Asia/Dhaka and fixed on first dispatch. Changing the cutoff does not delete old acknowledgement links. Do not use RM CreatedAt as the account cutoff.

Existing dbo.NotificationDelivery, pdf audit and SMS quota infrastructure remain prerequisites from the original application. No existing ledger/table/flag is cleared. Review legacy CityAgent outcomes before rollout: blocking legacy AGENT/CITYBANK ledger states are checked automatically, but flag-only historical sends without ledger records require operational review.

Build the React frontend with npm ci and npm run build in frontend. Publish its dist as usual. Restart the backend and inspect the API route list. No live sending is performed by installation, discovery, preview, or opening a PDF. Existing scheduled submission sending continues when jobs are enabled.

## Endpoints

- GET /api/bo/accounts?offset=0&limit=25&q=2311
- POST /api/bo/accounts/sync
- GET /api/bo/accounts/:id/preview
- POST /api/bo/accounts/:id/send with JSON {"hash":"preview hash"}
- GET /api/BOACK?BOID=<random URLCode>

The existing no-login IT/admin portal convention is preserved. Send endpoints must remain on your internal/admin network; acknowledgement PDFs are intentionally public bearer links. There is no Notification Manager or arbitrary SQL editor.

## Delivery and recovery

Each account, role and MOBILE/EMAIL channel has a separate BO_ACCOUNT delivery claim using the existing SQL DeliveryLedger. Preview includes ledger states. A manual repeat skips ACCEPTED/SENT, UNKNOWN and IN_FLIGHT. Definite provider rejection is FAILED and can be retried with another explicit IT send. No automatic account-opening retries occur.

Only explicit rejection allows mobile fallback. Timeouts are UNKNOWN, not proof of non-delivery. Existing SmsChannel does not mark every SMS rejection definitelyNotSent; SMS-first fallback is therefore intentionally conservative. Investor email and internal recipients still proceed after an ordinary provider error on a different recipient. A database failure persisting an outcome may stop the manual request; claims already in flight block duplicate sends until reconciled.

Stop/unmount in the UI stops future account requests; it cannot cancel a request already accepted by the server. A single account request may complete its independent recipients even if the browser closes. Refresh preview to view outcomes before repeating.

## Validation checklist

1. Use UAT database copies and test provider destinations; leave production jobs off while first testing.
2. Discover twice: one investor/BO maps to the same URLCode.
3. Before-cutoff and empty BO/VA rows are excluded. A non-13-digit VA is held for review.
4. Missing PDF holds applicant messages. Missing/inactive RM holds relevant messages. Fix upstream data and rediscover before first dispatch.
5. Direct account: applicant and RM only. Referral: Agent and Bank added. Missing Agent: neither Agent nor Bank is sent.
6. Simulate WhatsApp rejection: applicant SMS fallback. Simulate timeout: UNKNOWN, no fallback/resend.
7. Repeat send and run two workers: accepted/claimed recipients are not sent twice.
8. Simulate audit failure after provider acceptance: no duplicate provider call.
9. Verify actual PDF bytes for 2311 match the investor before production.
10. Review source-to-local SQL and provider API contracts in UAT before enabling.

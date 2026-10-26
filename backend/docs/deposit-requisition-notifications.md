# Deposit Requisition notifications

RECEIPTREQ now sends to the investor, the investor's mapped RM WhatsApp group, and Finance independently. Personal RM messaging is disabled for this module. Trade Confirmation, Payment and Deposit VA retain their current behavior.

## Environment

Add these values to the backend environment before enabling DepositReqModule. Choose the cutoffs deliberately; these examples allow source records from 26 October 2026 onward.

```dotenv
DEPOSITREQ_SYNC_SINCE=2026-10-26T00:00:00
DEPOSITREQ_NOTIFY_SINCE=2026-10-26T00:00:00
DEPOSITREQ_MOBILE_FIRST=WHATSAPP
DEPOSITREQ_WHATSAPP_ENABLED=true
DEPOSITREQ_SMS_ENABLED=true
DEPOSITREQ_EMAIL_ENABLED=false
DEPOSITREQ_RM_GROUP_ENABLED=true
DEPOSITREQ_RM_GROUP_SESSION_ID=it
DEPOSITREQ_RM_GROUP_NOTIFY_SINCE=2026-10-26T00:00:00
DEPOSITREQ_FINACC_GROUP_ENABLED=true
DEPOSITREQ_FINACC_GROUP_NOTIFY_SINCE=2026-10-26T00:00:00
DEPOSITREQ_TEST_GROUP=demo group
```

Only NOTIFY_SINCE is required. Other cutoffs default to it. Defaults are WhatsApp enabled, SMS/email disabled, RM group disabled, Finance group enabled. Invalid configuration fails at module initialization. A synchronization cutoff cannot be later than the notification cutoff. The existing central scheduler controls the cycle interval.

RM group is read from poolPromise dbo.rm_info.Whatsapp_group where tradercode matches the investor Trader. Conflicting distinct mappings or an empty mapping skip the RM group only. Finance uses the existing WhatsApp AccgroupName/groupSessionId configuration. RM uses DEPOSITREQ_RM_GROUP_SESSION_ID, falling back to the shared group session.

A nonempty TEST_GROUP replaces both group destinations with one DEMO_GROUP delivery per requisition, including when an RM mapping is missing. It uses the shared Finance group session. It does not redirect investor mobile/email: keep the existing testMobile/testEmail overrides configured in UAT. Group switches and source cutoffs still apply.

For production, clear DEPOSITREQ_TEST_GROUP and restart. Demo delivery records do not mark the real groups as sent. If testing and production share a database, clearing the override can send eligible real group notifications for previously tested requisitions. Use separate UAT storage or advance production cutoffs to the intended launch time. Never reset existing sent flags or delivery claims.

## Delivery and recovery

Existing source/sync/notification tables, receipt URLs, and ledger identity RECEIPTREQ:dbo.depositReqNotification remain unchanged. Roles INVESTOR, RM_GROUP, FINACC and DEMO_GROUP have independent claims. Prior accepted investor or Finance deliveries remain protected. New RM_GROUP deliveries can backfill eligible pending history, so choose the RM group cutoff carefully.

Investor uses the first comma-separated mobile/email. Group copies use RECEIPTREQ.textRM, falling back to text; investor uses text. dateTime comes from SourceInTimestamp. A confirmed mobile provider rejection can fall back to the other enabled mobile channel. An uncertain timeout is held UNKNOWN for manual reconciliation and does not automatically fall back or resend. Each group is WhatsApp-only; one recipient failure does not stop the others.

Synchronization retains the existing increasing RecordID cursor. Changing the cutoff does not rewind it. Records inserted or made eligible below the saved maximum ID require deliberate reconciliation.

## Verify before deployment

1. Keep production module registrations in bootstrap/modules.js; enable DepositReqModule deliberately.
2. Configure the cutoffs and safe UAT investor overrides/demo group.
3. Run `node --test backend/test/*.cjs` with frontend dependencies installed (`npm ci` in frontend for the existing esbuild-based regression tests).
4. Submit a new deposit requisition and verify investor and one demo group copy, both showing the database request time.
5. Run another cycle: accepted deliveries must not repeat.
6. Test a rejected investor WhatsApp number with SMS enabled: SMS and the independent group must still proceed.
7. In separate UAT data, clear the demo override and verify mapped RM and Finance group deliveries. Missing RM mapping must not block Finance.
8. Review audit statuses and NotificationDelivery/NotificationRecipient outcomes. Reconcile UNKNOWN before any manual retry.

Tests mock providers and database requests; they do not replace an actual UAT test of SQL permissions, schema, source timestamps and WhatsApp group membership.

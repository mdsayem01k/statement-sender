# DepositApprove

A separate approval notification module. Deposit VA and Deposit Requisition continue to notify when the investor requests a deposit; this module notifies when an eligible deposit appears in XBpoolPromise dbo.Payments_tblInvestorPayments.

## Install and enable

Apply the supplied patch to an up-to-date UAT branch based on main e7d54d7 or a compatible descendant. Review bootstrap/modules.js rather than replacing production module registrations wholesale. Existing registrations are preserved by the patch; the Deposit VA import capitalization is corrected to match depositVA.

Set backend environment values:

```dotenv
DEPOSITAPPROVE_ENABLED=true
DEPOSITAPPROVE_SYNC_SINCE=2026-10-26T00:00:00
DEPOSITAPPROVE_NOTIFY_SINCE=2026-10-26T00:00:00
DEPOSITAPPROVE_MOBILE_FIRST=WHATSAPP
DEPOSITAPPROVE_WHATSAPP_ENABLED=true
DEPOSITAPPROVE_SMS_ENABLED=true
DEPOSITAPPROVE_EMAIL_ENABLED=false
DEPOSITAPPROVE_RM_GROUP_ENABLED=false
DEPOSITAPPROVE_RM_GROUP_SESSION_ID=it
DEPOSITAPPROVE_RM_GROUP_NOTIFY_SINCE=2026-10-26T00:00:00
DEPOSITAPPROVE_FINACC_GROUP_ENABLED=false
DEPOSITAPPROVE_FINACC_GROUP_NOTIFY_SINCE=2026-10-26T00:00:00
DEPOSITAPPROVE_TEST_GROUP=demo group
```

This example enables investor WhatsApp with SMS fallback. Set RM_GROUP_ENABLED and FINACC_GROUP_ENABLED to true if approval copies are wanted. Groups are independent WhatsApp deliveries, use textRM, and never use the RM's personal mobile. RM group comes from poolPromise dbo.rm_info.Whatsapp_group matched by tradercode; Finance group comes from the existing AccgroupName and groupSessionId settings.

Enabled defaults to false, so adding the code does not start approval sends until explicitly enabled. With the module enabled, NOTIFY_SINCE is required. Other cutoffs default to it. Channel defaults match Deposit Requisition: WhatsApp true, SMS/email false, RM group false, Finance group true. Set explicit values rather than relying on defaults.

Choose cutoffs before enabling. They use PaymentDate, which is often midnight; choose a date boundary such as 2026-10-26T00:00:00. Setting midday excludes payments stored at midnight that day. This is an accounting/payment date, not a verified approval timestamp.

The central scheduler uses the existing ENABLE_JOBS and PIPELINE_INTERVAL_MIN settings. Each cycle synchronizes all enabled modules before delivering pending notifications. The next cycle starts after the configured interval following completion.

## Storage and identity

- Source: XBpoolPromise dbo.Payments_tblInvestorPayments, primary key paymentID.
- Local application database: poolPromise dbo.DepositApproveSync and dbo.DepositApproveNotification.
- Local source uniqueness: SourcePaymentID, converted to NVARCHAR(100), including bigint IDs without JavaScript numeric conversion.
- Internal local identity: ApprovalID; notification identity: NotificationID.
- Ledger namespace: DEPOSIT_APPROVE:dbo.DepositApproveNotification.
- Independent roles: INVESTOR, RM_GROUP, FINACC, DEMO_GROUP.

The existing ensureTables flow creates the new local tables and shared delivery tables using application DB permissions. No XB tables or existing deposit notification flags are updated. Approval notifications use no PDF URL; internal UrlCode values support the existing pending-record framework only.

## Source selection and recovery

Only PaymentTypeID=1 and PayModeID NOT IN (4,8) qualify, joined to Setup_tblInvestor and Payments_tblPayMode. Business date is MAX(EODDate)+1 as supplied. A missing EOD date fails synchronization visibly.

Unlike an equality-only current-day query, synchronization scans the configured date window through the end of the current business date. Already synchronized paymentIDs are excluded using local records. This catches eligible payments after downtime or late insertion and avoids skipping a lower ID that arrives later. The source query may read a growing window every cycle; select a deliberate cutoff and assess an appropriate existing XB index on PaymentDate with the DBA before large-scale use.

This assumes appearance in the supplied XB table with those filters means approval. If that table can also contain unapproved entries, add the real approval-status predicate before enabling; none was provided in the source query.

## UAT

1. Keep real investor delivery redirected through the existing testMobile/testEmail settings. TEST_GROUP redirects groups only.
2. Enable desired group switches and use a demo group in the shared Finance WhatsApp session. The demo group receives one copy per payment even with both group switches enabled, and has separate tracking from real groups.
3. Verify two different paymentIDs for the same investor produce two approval notifications; the next cycle must not repeat accepted sends.
4. Verify withdraw entries and pay modes 4/8 are excluded.
5. Verify WhatsApp rejection falls back to SMS and group deliveries continue independently.
6. Verify restart recovery: accepted records are reconciled without sending again; uncertain provider responses remain UNKNOWN for manual review.
7. Before production, clear DEPOSITAPPROVE_TEST_GROUP, set explicit recipient flags and deliberate production cutoffs, and restart. If UAT and production share storage, changing from demo to real groups can send real copies for eligible tested rows; prefer separate databases.

Tests: install frontend dependencies with npm ci in frontend, then run node --test backend/test/*.cjs from the repository root. Build frontend with npm run build in frontend. Tests mock SQL/providers; verify actual schema, permissions and group membership in UAT.

## Operations

GET /api/deposit-approve/notifications supports limit (1-200), offset and q. It lists local approval records with investor send flags/errors. GET /api/jobs/status shows cycle outcomes. The existing pipeline run API executes the entire pipeline, not approval alone. Existing audit logs and daily reports recognize DEPOSIT_APPROVE statuses.

Rollback: set DEPOSITAPPROVE_ENABLED=false and restart. Keep local sync/notification/ledger tables intact so re-enabling retains duplicate protection. Do not reset sent flags or delete UNKNOWN records to force a retry.

Statement Sender — Production / Live Checklist
Prepared: 18 October 2026, Asia/Dhaka.
Save this file in your project as docs/PRODUCTION_CHECKLIST.md.
Release commit: __________  Previous working commit: __________
Deployment time: __________  Checked by: __________
1. Release status and known issues
This checklist is based on repository commit e6e4efe and the subsequent local withdrawal fix. It is not evidence that Live has passed these checks.
- [ ] Confirm the intended modules are registered in backend/src/bootstrap/modules.js. At reviewed commit e6e4efe, only CityAgent was enabled; Trade Confirmation, Portfolio, Deposit Requisition, Payment and BO Registration were commented out.
- [ ] Include the withdrawal SourceInTimestamp / dateTime correction in the release if enabling Payment or Deposit Requisition.
- [ ] Confirm the correction was pushed to GitHub. Local commit c98175d was prepared, but its push failed because GitHub credentials were unavailable in the review environment. A commit made on your own machine can have a different hash.
- [ ] Decide whether the hardcoded three-SMS-attempts-per-number/day application limit is appropriate. It remains in SmsLimitService.js and can block repeated City Bank SMS notifications even when the provider allows them.
- [ ] Confirm CityAgent and pipeline tests are included in your release. Reviewed GitHub had only 24 committed tests; these did not directly cover CityAgent or the central pipeline.
Review evidence: the reviewed checkout passed 24 tests, 63 backend syntax checks and a frontend production build. After the local withdrawal correction, 29 tests passed. These were local/mock checks, not Live database or provider tests.
2. Before changing Live
- [ ] Record the current production commit and local modifications.
- [ ] Back up the application database and verify the backup completed.
- [ ] Preserve the deployed frontend build and previous backend release.
- [ ] Back up production .env and env.js securely without committing them.
- [ ] Review pending deliveries and active Trade batches before restarting.
- [ ] Identify the existing Windows service/process manager and restart procedure.
- [ ] Prepare a previous-release directory for rollback.
Run from the production project directory:
git branch --show-current
git log -1 --oneline
git status --short
If there are local changes, review and preserve them before pulling. Do not use git reset --hard or discard production files merely to make a pull succeed.
3. Test and promote UAT
Run dependency installation and tests in UAT or a separate release checkout, not over a running Live application's dependencies.
cd frontend
npm ci
npm run build:live
cd ..
node --test backend/test/*.cjs
- [ ] Tests pass with the actual release files.
- [ ] Test fixtures include SourceInTimestamp for Payment request rows.
- [ ] Production frontend environment values are supplied during the build.
- [ ] VITE_API_BASE and VITE_DOCUMENT_BASE point to Live.
- [ ] VITE_ENV_LABEL identifies Live rather than UAT.
- [ ] No frontend test invokes real customer delivery endpoints.
Vite environment values are compiled into the frontend. Changing .env after building does not update an existing dist folder. A backend-only withdrawal date fix does not require rebuilding the frontend.
After testing the UAT branch, promote from your development/UAT checkout:
git switch main
git pull --ff-only origin main
git merge --ff-only uat
git push origin main
If fast-forward fails, inspect branch differences in UAT and resolve them there. Do not force-push or resolve production conflicts by deleting local configuration.
Then, from production on the intended main branch with a clean working tree:
git pull --ff-only origin main
git log -1 --oneline
git status --short
- [ ] Production commit matches the tested release.
- [ ] Only required dependency changes are installed, through the normal service maintenance procedure.
- [ ] Required database migrations were applied before enabling dependent features.
- [ ] Restart the backend through the existing service manager.
4. Production configuration
Verify privately; do not paste secrets into logs, screenshots or this checklist.
- [ ] poolPromise points to the intended application database.
- [ ] BOpoolPromise points to the intended BO database.
- [ ] XBpoolPromise points to the intended XB database.
- [ ] Database permissions allow required reads, writes and initialization/migrations.
- [ ] Provider URLs, WhatsApp session, SMTP credentials and sender address are correct.
- [ ] Resolved env.notify.testMobile and env.notify.testEmail overrides are empty for real delivery.
- [ ] Finance group configuration points to the production group.
- [ ] ENABLE_JOBS=true on only one automatic worker process.
- [ ] Other API instances use ENABLE_JOBS=false.
- [ ] PIPELINE_INTERVAL_MIN=1, or the intended interval.
- [ ] Source and notification cutoffs retain the intended dates; do not move them backwards just to test.
- [ ] Production PDF/archive paths are reachable by the service account.
For CityAgent, verify the intended values explicitly:
CITYAGENT_ENABLED=true
CITYAGENT_MOBILE_FIRST=WHATSAPP
CITYAGENT_WHATSAPP_ENABLED=true
CITYAGENT_SMS_ENABLED=true
CITYAGENT_EMAIL_ENABLED=true
These are example settings, not a requirement to enable every channel. With the central pipeline, PIPELINE_INTERVAL_MIN controls timing. Include CITYAGENT in ModuleRegistry.getPipeline() and do not separately start its own timer.
5. Read-only API checks
curl.exe https://statements.citybrokerageltd.com/health
curl.exe https://statements.citybrokerageltd.com/api/routes
curl.exe https://statements.citybrokerageltd.com/api/jobs/status
curl.exe https://statements.citybrokerageltd.com/api/city-agent/notifications
Check	Expected
/health	HTTP 200 and status: UP; this alone does not prove database/provider availability
/api/routes	Required production module routes are present
/api/jobs/status	Intended jobs, correct interval, advancing cycle times, no unexplained errors
/api/city-agent/notifications	Local records and independent recipient/channel outcomes are visible
Backend startup	Correct port and expected modules/routes
Database startup	All three intended connections succeed


- [ ] HTTPS and IIS/reverse-proxy routing work from a client computer.
- [ ] Frontend loads after refresh and browser console shows no API/CORS failures.
- [ ] Historical and current PDFs return the selected document/date, where enabled.
Do not use /api/jobs/pipeline/run, /api/jobs/:type/run, or any send endpoint as a read-only health check. Manual job-run endpoints can trigger the whole enabled pipeline even when automatic jobs are disabled.
6. Database checks
Run in the application database used by poolPromise:
SELECT
    required.TableName,
    CASE
        WHEN OBJECT_ID(required.TableName, 'U') IS NULL
            THEN 'MISSING'
        ELSE 'EXISTS'
    END AS TableStatus
FROM (
    VALUES
        ('dbo.AgentInfo'),
        ('dbo.CityAgentNotification'),
        ('dbo.NotificationRecipient'),
        ('dbo.NotificationDelivery'),
        ('dbo.SmsDailyLimit'),
        ('dbo.TradeSendBatch'),
        ('dbo.TradeSendItem')
) required(TableName);
- [ ] Tables required by enabled features exist, with the correct columns and constraints.
- [ ] Trade batch tables exist if resumable Trade sending is used.
- [ ] Use the actual migration scripts supplied with the feature. Reviewed GitHub did not include a backend/sql directory; do not assume required tables are installed automatically.
Check contacts if CityAgent is enabled:
SELECT id, name, mobile, email, refcode
FROM dbo.AgentInfo
WHERE refcode = 'city';

SELECT
    LOWER(LTRIM(RTRIM(refcode))) AS RefCode,
    COUNT(*) AS Total
FROM dbo.AgentInfo
GROUP BY LOWER(LTRIM(RTRIM(refcode)))
HAVING COUNT(*) > 1;
- [ ] Exactly one City Bank row has refcode='city'.
- [ ] Agent references match inv.ReferBO exactly as intended.
- [ ] No duplicate contact reference codes.
- [ ] The first comma-separated mobile/email is the intended recipient.
If the ledger exists, inspect delivery state:
SELECT Module, RecipientRole, Via, State, COUNT(*) AS Total
FROM dbo.NotificationDelivery
GROUP BY Module, RecipientRole, Via, State
ORDER BY Module, RecipientRole, Via, State;

SELECT TOP (50)
    Module,
    NotificationID,
    RecipientRole,
    Via,
    State,
    Error,
    UpdatedAt
FROM dbo.NotificationDelivery
WHERE State IN ('UNKNOWN', 'IN_FLIGHT', 'FAILED')
ORDER BY UpdatedAt DESC;
SENT is the application's completed state after provider acceptance and persistence; it is not proof of handset/inbox receipt. Investigate uncertain and expired claims without resetting all sent flags.
7. Controlled functional tests
Run failure, crash, concurrency and backlog tests in isolated UAT with test contacts and an isolated application database. Setting one test phone while retaining a full production backlog can still send that phone many messages.
Before any controlled Live send, inspect the complete pending backlog. The first CityAgent scan can include historical eligible accounts; it is not restricted to a single test investor.
CityAgent
Source mapping:
- BO: Investor_tblBOInvestorBOOpen inv joined to Investor_tblBORegistrationMaster ma by BORegistrationMasterID.
- BO filters: inv.isReferBO='1' and nonempty ma.CustomCode.
- Match ma.CustomCode to XB Setup_tblInvestor.InvestorCode.
- XB filter: boid LIKE '1204500%' AND LEN(boid)>10.
- Agent: inv.ReferBO matched to poolPromise.dbo.AgentInfo.refcode.
- City Bank: AgentInfo.refcode='city'.
Scenario	Expected	Result
Eligible investor and matching agent	Enabled mobile/email sent separately to agent and City Bank	[ ]
Agent not found	Neither agent nor City Bank receives messages	[ ]
BOID outside prefix/length rule	No delivery	[ ]
First mobile channel succeeds	No second mobile-channel send	[ ]
Confirmed WhatsApp rejection	SMS fallback if enabled	[ ]
SMS first, confirmed non-delivery	Verify fallback classification; current wrapper explicitly marks quota rejection but generic SMS errors remain uncertain	[ ]
Provider timeout	UNKNOWN; no automatic resend/fallback	[ ]
Email disabled	No email attempt or disabled-email backlog selection	[ ]
No new source rows	Existing eligible pending deliveries can progress	[ ]
Next cycle/restart	Completed recipient/channel deliveries are skipped	[ ]


CityAgent message date uses configured BO source date, or first-stored database time when none is configured. Do not label the fallback as the verified account-opening time.
Payment / Deposit Requisition
- [ ] Pending SELECT includes s.SourceInTimestamp.
- [ ] buildData() supplies dateTime to both text and textRM.
- [ ] SQL time 2026-10-14 09:49:25.773 displays as 14 Oct 2026 ||9:49AM.
- [ ] Investor failure does not block independent RM or Finance group delivery.
- [ ] Finance group receives the intended internal template.
- [ ] Email follows the configured policy.
- [ ] Old UNKNOWN records from the missing-dateTime error are reviewed separately; deploying code alone does not reset them.
BO Registration
- [ ] Source and notification cutoffs are correct.
- [ ] One eligible submission generates the correct application link.
- [ ] Database StepDate appears correctly in the message.
- [ ] No RM or Finance group delivery occurs.
- [ ] Subsequent cycles do not repeat completed deliveries.
Trade Confirmation / Portfolio
- [ ] Required modules and manual routes are enabled.
- [ ] Selected historical document code and date remain intact.
- [ ] Trade Confirmation mobile delivery remains SMS-only.
- [ ] Confirm a selected PDF exists and matches its original document date.
- [ ] For resumable Trade batches, test pause/resume and uncertain-outcome reconciliation in UAT.
- [ ] In UAT, simulate 201 completed items out of 400 and confirm only remaining pending items are dispatched after recovery.
- [ ] Keep manual Trade testing separate from automatic pipeline tests.
8. Observe after deployment
- [ ] Watch at least three full cycles, including their completion timestamps.
- [ ] Each cycle attempts all enabled module synchronizations before notifications.
- [ ] Next cycle starts the configured interval after completion, with no process-local overlap.
- [ ] Source errors do not prevent other enabled modules from progressing.
- [ ] Pending delivery remains possible after a source outage if the application database is available.
- [ ] Check real recipient phones/inboxes for the controlled test and compare them with audit/ledger entries.
- [ ] Review unexpected UNKNOWN, FAILED, missing-contact and SMS-limit errors.
- [ ] Confirm manual Trade API latency remains acceptable during automatic sending.
Review timing in one timezone. Pipeline JSON timestamps ending in Z are UTC; Dhaka is UTC+06:00. SQL wall-clock dates follow the database/driver convention used by the application.
9. Failure and recovery
If unexpected or duplicate sends occur:
1. Stop the automatic worker or disable its jobs through the normal service procedure.
2. Record the release commit, cycle times, investor IDs and provider references.
3. Preserve the application database and provider/audit evidence.
4. Distinguish known rejection from accepted delivery and uncertain timeout.
5. Do not delete ledger rows, clear SENT states, reset all recipient flags, or recreate a batch to force delivery.
6. Verify UNKNOWN outcomes with the provider before deciding whether retry is safe.
7. Restore a known-good application release only after checking compatibility with the current schema.
8. Recheck pending work and resume through supported claim/reconciliation paths.
Do not restore an older database backup over a database containing newly accepted deliveries merely to roll back code. Losing those records can cause duplicate messages. No recovery or Live action is performed by this document.
10. Release result
- [ ] Code and configuration match the intended release.
- [ ] Required modules, schema and source mappings are verified.
- [ ] Controlled recipient checks passed.
- [ ] No unexplained duplicate sends or unresolved release-blocking errors.
- [ ] Previous release and database backup remain available.
Result: PASS / HOLD
Open issues: ______________________________
Evidence / logs: ___________________________
Checked at, Asia/Dhaka: ____________________
# Virtual account landing page

GET /va displays an HTML form. POST /va accepts investorCode as form data and renders the virtual bank account number in the same page. Everything is served/rendered by the Node backend; there is no React route or frontend build requirement.

The query uses XBpoolPromise and dbo.Setup_tblInvestor, selecting InvestorCode and virtualbankaccountNo with a bound @code parameter. The code 2311 is an example input, not a hardcoded filter. Leading zeros are preserved. Duplicate matching investor rows return an unavailable response rather than selecting an arbitrary account.

Install the three files in this module folder and the updated backend/src/app.js from the patch/package. Preserve your current .env and source database settings. Restart the backend, then visit http://localhost:4000/va (adjust your port/domain). Configure XB_DB_SERVER, XB_DB_NAME, XB_DB_USER, XB_DB_PASSWORD and optional XB_DB_PORT for your real UAT XBroker source.

No new tables, database migrations, notification switches, React changes or provider calls are required. The route is /va, outside /api, so it is not listed by the module registry's /api/routes endpoint. If IIS handles this host, ensure /va and POST /va are forwarded to Node rather than the React SPA fallback.

The page intentionally uses investor-code-only lookup, as requested; no login or OTP is introduced. Responses use no-store and do not place investor/account values into the URL. Verify the intended accessibility of account-number lookup in your deployment.

Validation: eight mocked tests cover initial rendering without database access, first lookup, leading zeros, invalid/repeated inputs, missing accounts, escaped output, database errors, parameter binding and ambiguous source rows. No real database connection or notification provider was used.

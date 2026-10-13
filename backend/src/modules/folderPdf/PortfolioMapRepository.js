const Db = require('../../core/Db');
const env = require('../../config/env');

// Table "portfolioMap": url code <-> investor code. Shared by trade confirmation and portfolio.
class PortfolioMapRepository {
  async expectedClientCodes(scheduleID) {
    const { sql } = Db;
    const p = await Db.pool();
    const { ip, db } = env.linkedServer; // was hardcoded in PortfolioMap.model.js
    const r = await p.request().input('scheduleID', sql.Int, scheduleID)
      .query(`SELECT clientCode FROM [${ip}].[${db}].[dbo].tblAutoEmailLog WHERE scheduleID = @scheduleID`);
    return r.recordset.map((x) => x.clientCode);
  }

  async insert({ code, urlcode, name = null, documentFilename }) {
    const { sql } = Db;
    const pool = await Db.pool();
    const result = await pool.request()
      .input('code', sql.VarChar(50), String(code).trim())
      .input('urlcode', sql.VarChar(255), urlcode)
      .input('name', sql.VarChar(255), name)
      .input('documentFilename', sql.VarChar(255), documentFilename)
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          DECLARE @documentDate DATE = CONVERT(DATE, GETDATE());
          DECLARE @resource NVARCHAR(255) = CONCAT('PDFMAP_GENERATE:', CONVERT(VARCHAR(10), @documentDate, 23));
          DECLARE @lockResult INT;
          EXEC @lockResult = sys.sp_getapplock
            @Resource = @resource,
            @LockMode = 'Exclusive',
            @LockOwner = 'Transaction',
            @LockTimeout = 10000;
          IF @lockResult < 0 THROW 50002, 'Unable to acquire URL-generation lock.', 1;
          DECLARE @existing VARCHAR(255);
          SELECT TOP 1 @existing = urlcode
          FROM dbo.portfolioMap
          WHERE code = @code
            AND insert_date >= @documentDate
            AND insert_date < DATEADD(DAY, 1, @documentDate)
          ORDER BY insert_date DESC, urlcode ASC;
          IF @existing IS NULL
          BEGIN
            INSERT INTO dbo.portfolioMap
              (code, urlcode, name, document_filename, insert_date)
            VALUES
              (@code, @urlcode, @name, @documentFilename, @documentDate);
            SET @existing = @urlcode;
          END;
          COMMIT TRANSACTION;
          SELECT @existing AS urlcode;
        END TRY
        BEGIN CATCH
          IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;
      `);
    if (!result.recordset?.[0]?.urlcode) throw new Error('URL generation returned no mapping');
    return result.recordset[0].urlcode;
  }

  // code + insert_date (needed to find the right dated folder)
  async findByUrlCode(urlcode) {
    const { sql } = Db;
    const p = await Db.pool();
    const r = await p.request().input('c', sql.VarChar(255), urlcode)
      .query('SELECT code AS Code, insert_date FROM portfolioMap WHERE urlcode = @c');
    return r.recordset[0] || null;
  }

  async resolveUrlCode(urlcode) {
    const { sql } = Db;
    const p = await Db.pool();
    const r = await p.request().input('c', sql.VarChar(255), urlcode)
      .query('SELECT code AS resolvedCode, urlcode, insert_date FROM portfolioMap WHERE urlcode = @c');
    return r.recordset[0] || null;
  }

  // linkPrefix example: 'https://host/api/report/pdf?BOID='
  async findUrls({ investorCode, date, linkPrefix }) {
    const { sql } = Db;
    const p = await Db.pool();
    const request = p.request().input('prefix', sql.VarChar(500), linkPrefix);
    let query = `SELECT concat(@prefix, urlcode) AS url, code AS investorCode, insert_date FROM portfolioMap WHERE 1=1`;
    if (investorCode) { request.input('investorCode', sql.VarChar(100), investorCode); query += ' AND code = @investorCode'; }
    if (date) { request.input('insertDate', sql.Date, date); query += ' AND CAST(insert_date AS DATE) = @insertDate'; }
    return (await request.query(`${query} ORDER BY code ASC`)).recordset;
  }

  // Newest url code for an investor + where to reach them.
  // TODO: portfolioMap has no mobile / email column yet, so the test values from env are used (as before).
  // Replace the two env values with a real lookup when a contact table exists.

async ContactInfo(code) {
  const { sql } = Db;
  const p = await Db.pool('XBpoolPromise');

  const r = await p.request()
    .input('code', sql.VarChar(100), String(code).trim())
    .query(`
      SELECT
        cellno as mobile,
        email as email
      FROM dbo.Setup_tblInvestor
      WHERE InvestorCode = @code
    `);

  return r.recordset[0] || null;
}

async findContactByCode(code, urlcode = null) {
  const { sql } = Db;
  const p = await Db.pool();
  const investorCode = String(code).trim();

  console.log('sent to sms: ',code);

  const r = await p.request()
    .input('code', sql.VarChar(100), investorCode)
    .input('urlcode', sql.VarChar(255), urlcode)
    .query(`
      SELECT TOP 1
        code AS investor,
        urlcode AS encrypto_code
      FROM dbo.portfolioMap
      WHERE code = @code
        AND (@urlcode IS NULL OR urlcode = @urlcode)
      ORDER BY insert_date DESC, urlcode ASC
    `);

  const row = r.recordset[0];

  if (!row) {
    return null;
  }

  const contact = await this.ContactInfo(investorCode);

  if (!contact) {
    throw new Error(
      `Investor ${investorCode} was not found in Setup_tblInvestor`
    );
  }
  console.log('sent sms to this num:',contact.mobile);
  return {
    ...row,
    mobile: String(contact.mobile || '').split(',')[0].trim(),
    email: String(contact.email || '').split(',')[0].trim()
  };
}
}

module.exports = PortfolioMapRepository;

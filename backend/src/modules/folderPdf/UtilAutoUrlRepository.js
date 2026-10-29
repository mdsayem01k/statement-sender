const Db = require('../../core/Db');
const env = require('../../config/env');

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function investorCode(value) {
  const code = String(value ?? '').trim();
  if (!code || code.length > 10) {
    throw invalid('Investor code must contain 1 to 10 characters');
  }
  return code;
}

function token(value) {
  const code = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{6,30}$/.test(code)) {
    throw invalid('URL code must contain 6 to 30 letters, digits, underscores or hyphens');
  }
  return code;
}

function documentDate(value) {
  if (value == null) return null;
  if (value instanceof Date && Number.isNaN(value.getTime())) throw invalid('Document date must be valid');
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw invalid('Document date must be a valid YYYY-MM-DD date');
  }
  return parsed;
}

class UtilAutoUrlRepository {
  constructor({ refID = 2, linkPrefix = '' } = {}) {
    if (![1, 2].includes(refID)) throw invalid('RefID must be 1 for Portfolio or 2 for Trade Confirmation');
    this.refID = refID;
    this.linkPrefix = String(linkPrefix).trim();
  }

  prefix(value = this.linkPrefix) {
    const prefix = String(value || '').trim();
    if (!/^https?:\/\//i.test(prefix) || !prefix.endsWith('BOID=') || prefix.length > 94) {
      throw invalid('A valid public PDF URL prefix ending in BOID= is required');
    }
    return prefix;
  }

  pool() {
    return Db.pool('XBpoolPromise');
  }

  async expectedClientCodes(scheduleID = this.refID) {
    if (Number(scheduleID) !== this.refID) {
      throw invalid(`Use the RefID ${Number(scheduleID)} module generation endpoint; this module is RefID ${this.refID}`);
    }
    const { sql } = Db;
    const pool = await Db.pool();
    const { ip, db } = env.linkedServer;
    const result = await pool.request()
      .input('scheduleID', sql.Int, this.refID)
      .query(`SELECT clientCode FROM [${String(ip).replace(/]/g, ']]')}].[${String(db).replace(/]/g, ']]')}].[dbo].tblAutoEmailLog WHERE scheduleID = @scheduleID`);
    return result.recordset.map(row => row.clientCode);
  }

  async insert({ code, urlcode, documentDate: date = null }) {
    const client = investorCode(code);
    const urlCode = token(urlcode);
    const prefix = this.prefix();
    if (prefix.length + urlCode.length > 100) throw invalid('Generated link exceeds UTIL_Auto_URL.Link varchar(100)');
    const { sql } = Db;
    const pool = await this.pool();
    const result = await pool.request()
      .input('refID', sql.Int, this.refID)
      .input('code', sql.VarChar(10), client)
      .input('urlcode', sql.VarChar(30), urlCode)
      .input('prefix', sql.VarChar(100), prefix)
      .input('documentDate', sql.Date, documentDate(date))
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          DECLARE @day DATE = COALESCE(@documentDate, CONVERT(DATE, GETDATE()));
          DECLARE @resource NVARCHAR(255) = CONCAT(
            'UTIL_AUTO_URL:', @refID, ':', UPPER(@code), ':', CONVERT(VARCHAR(10), @day, 23)
          );
          DECLARE @lockResult INT;
          EXEC @lockResult = sys.sp_getapplock
            @Resource = @resource, @LockMode = 'Exclusive',
            @LockOwner = 'Transaction', @LockTimeout = 10000;
          IF @lockResult < 0 THROW 50002, 'Unable to acquire URL-generation lock.', 1;
          DECLARE @existing VARCHAR(30);
          SELECT TOP (1) @existing = URLCode
          FROM dbo.UTIL_Auto_URL
          WHERE RefID = @refID AND InvestorCode = @code AND CreateAt = @day
            AND NULLIF(URLCode, '') IS NOT NULL
          ORDER BY InTimestamp DESC, URLCode ASC;
          IF @existing IS NULL
          BEGIN
            INSERT INTO dbo.UTIL_Auto_URL
              (RefID, InvestorCode, Link, URLCode, CreateAt, InTimestamp)
            VALUES (@refID, @code, CONCAT(@prefix, @urlcode), @urlcode, @day, GETDATE());
            SET @existing = @urlcode;
          END
          ELSE
          BEGIN
            IF DATALENGTH(@prefix) + DATALENGTH(@existing) > 100
              THROW 50003, 'Canonical link exceeds UTIL_Auto_URL.Link varchar(100).', 1;
            UPDATE dbo.UTIL_Auto_URL
            SET Link = CONCAT(@prefix, @existing)
            WHERE RefID = @refID AND URLCode = @existing;
          END;
          COMMIT TRANSACTION;
          SELECT @existing AS urlcode;
        END TRY
        BEGIN CATCH
          IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`);
    const canonical = result.recordset?.[0]?.urlcode;
    if (!canonical) throw new Error('URL generation returned no UTIL_Auto_URL mapping');
    return canonical;
  }

  async findByUrlCode(urlcode) {
    const { sql } = Db;
    const pool = await this.pool();
    const result = await pool.request()
      .input('refID', sql.Int, this.refID)
      .input('urlcode', sql.VarChar(30), token(urlcode))
      .query(`SELECT InvestorCode AS Code, CreateAt AS insert_date,
          InTimestamp AS mapping_created_at, Link AS storedLink
        FROM dbo.UTIL_Auto_URL
        WHERE RefID = @refID AND URLCode = @urlcode
          AND CreateAt IS NOT NULL AND NULLIF(LTRIM(RTRIM(InvestorCode)), '') IS NOT NULL`);
    return result.recordset[0] || null;
  }

  async resolveUrlCode(urlcode) {
    const { sql } = Db;
    const pool = await this.pool();
    const result = await pool.request()
      .input('refID', sql.Int, this.refID)
      .input('urlcode', sql.VarChar(30), token(urlcode))
      .query(`SELECT InvestorCode AS resolvedCode, URLCode AS urlcode,
          CreateAt AS insert_date, InTimestamp AS mapping_created_at
        FROM dbo.UTIL_Auto_URL
        WHERE RefID = @refID AND URLCode = @urlcode
          AND CreateAt IS NOT NULL AND NULLIF(LTRIM(RTRIM(InvestorCode)), '') IS NOT NULL`);
    return result.recordset[0] || null;
  }

  async findUrls({ investorCode: code, date, linkPrefix } = {}) {
    const { sql } = Db;
    const pool = await this.pool();
    const request = pool.request()
      .input('refID', sql.Int, this.refID)
      .input('prefix', sql.VarChar(100), this.prefix(linkPrefix || this.linkPrefix));
    let query = `SELECT CONCAT(@prefix, URLCode) AS url,
      InvestorCode AS investorCode, URLCode AS urlcode, CreateAt AS insert_date,
      InTimestamp AS mapping_created_at, Link AS storedLink
      FROM dbo.UTIL_Auto_URL WHERE RefID = @refID
        AND NULLIF(LTRIM(RTRIM(URLCode)), '') IS NOT NULL
        AND CreateAt IS NOT NULL AND NULLIF(LTRIM(RTRIM(InvestorCode)), '') IS NOT NULL`;
    if (code != null && String(code).trim()) {
      request.input('code', sql.VarChar(10), investorCode(code));
      query += ' AND InvestorCode = @code';
    }
    if (date != null) {
      request.input('documentDate', sql.Date, documentDate(date));
      query += ' AND CreateAt = @documentDate';
    }
    return (await request.query(`${query} ORDER BY InvestorCode ASC, CreateAt DESC, URLCode ASC`)).recordset;
  }

  async ContactInfo(code) {
    const { sql } = Db;
    const pool = await this.pool();
    const result = await pool.request()
      .input('code', sql.VarChar(10), investorCode(code))
      .query(`SELECT TOP (1) CellNo AS mobile, Email AS email
        FROM dbo.Setup_tblInvestor WHERE InvestorCode = @code ORDER BY InvestorID ASC`);
    return result.recordset[0] || null;
  }

  async findContactByCode(code, urlcode = null) {
    const client = investorCode(code);
    const { sql } = Db;
    const pool = await this.pool();
    const result = await pool.request()
      .input('refID', sql.Int, this.refID)
      .input('code', sql.VarChar(10), client)
      .input('urlcode', sql.VarChar(30), urlcode === null ? null : token(urlcode))
      .query(`SELECT TOP (1) InvestorCode AS investor, URLCode AS encrypto_code,
          CreateAt AS insert_date, InTimestamp AS mapping_created_at
        FROM dbo.UTIL_Auto_URL
        WHERE RefID = @refID AND InvestorCode = @code
          AND CreateAt IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(URLCode)), '') IS NOT NULL
          AND (@urlcode IS NULL OR URLCode = @urlcode)
        ORDER BY CreateAt DESC, InTimestamp DESC, URLCode ASC`);
    const row = result.recordset[0];
    if (!row) return null;
    const contact = await this.ContactInfo(client);
    if (!contact) throw new Error(`Investor ${client} was not found in Setup_tblInvestor`);
    return {
      ...row,
      mobile: String(contact.mobile || '').split(',')[0].trim(),
      email: String(contact.email || '').split(',')[0].trim()
    };
  }
}

module.exports = UtilAutoUrlRepository;

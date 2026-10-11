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
    const p = await Db.pool();
    await p.request()
      .input('code', sql.VarChar(50), code)
      .input('urlcode', sql.VarChar(255), urlcode)
      .input('name', sql.VarChar(255), name)
      .input('documentFilename', sql.VarChar(255), documentFilename)
      .query(`INSERT INTO portfoliomap (code, urlcode, name, document_filename, insert_date)
              VALUES (@code, @urlcode, @name, @documentFilename, GETDATE())`);
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
  async findContactByCode(code) {
    const { sql } = Db;
    const p = await Db.pool();
    const r = await p.request().input('code', sql.VarChar(100), code)
      .query('SELECT TOP 1 code AS investor, urlcode AS encrypto_code FROM portfolioMap WHERE code = @code ORDER BY insert_date DESC');
    const row = r.recordset[0];
    if (!row) return null;
    return { ...row, mobile: env.whatsapp.defaultTestMobile, email: env.mail.defaultNotificationEmail };
  }
}

module.exports = PortfolioMapRepository;

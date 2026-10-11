const Db = require('../core/Db');
const env = require('../config/env');

class AuditLogRepository {
  // adds the recipient_role column once (INVESTOR / RM). If that is not allowed, logging continues without it.
  async hasRoleColumn() {
    if (!this.roleCheck) {
      this.roleCheck = Db.pool()
        .then((p) => p.request().query(`IF COL_LENGTH('pdf_audit_logs','recipient_role') IS NULL ALTER TABLE pdf_audit_logs ADD recipient_role VARCHAR(20) NULL`))
        .then(() => true)
        .catch((err) => { console.warn('[AUDIT] recipient_role column not available:', err.message); return false; });
    }
    return this.roleCheck;
  }

  async insert({ encryptoCode, resolvedCode, clientIp, userAgent, status, statusCode, errorMessage, tradeDate, device, os, browser, recipientRole }) {
    const { sql } = Db;
    const pool = await Db.pool();
    const withRole = await this.hasRoleColumn();
    await pool.request()
      .input('recipientRole', sql.VarChar(20), recipientRole || null)
      .input('encryptoCode', sql.VarChar(255), encryptoCode || null)
      .input('resolvedCode', sql.VarChar(100), resolvedCode || null)
      .input('clientIp', sql.VarChar(45), clientIp || 'UNKNOWN')
      .input('userAgent', sql.VarChar(500), userAgent || null)
      .input('status', sql.VarChar(50), status)
      .input('statusCode', sql.Int, statusCode)
      .input('errorMessage', sql.VarChar(sql.MAX), errorMessage || null)
      .input('tradeDate', sql.Date, tradeDate || new Date())
      .input('deviceType', sql.VarChar(50), device)
      .input('osName', sql.VarChar(50), os)
      .input('browserName', sql.VarChar(50), browser)
      .query(`
        INSERT INTO pdf_audit_logs
          (encrypto_code, resolved_code, client_ip, user_agent, status, status_code, error_message, trade_date, device_type, os_name, browser_name${withRole ? ', recipient_role' : ''})
        VALUES
          (@encryptoCode, @resolvedCode, @clientIp, @userAgent, @status, @statusCode, @errorMessage, @tradeDate, @deviceType, @osName, @browserName${withRole ? ', @recipientRole' : ''})`);
  }

  async find({ resolvedCode, date }) {
    const { sql } = Db;
    const pool = await Db.pool();
    const request = pool.request().input('prefix', sql.VarChar(500), `${env.app.auditReportBaseUrl}/api/report/pdf?BOID=`);
    let query = 'SELECT concat(@prefix, encrypto_code) AS url, * FROM pdf_audit_logs WHERE 1=1';
    if (resolvedCode) { request.input('resolvedCode', sql.VarChar(100), resolvedCode); query += ' AND resolved_code = @resolvedCode'; }
    if (date) { request.input('tradeDate', sql.Date, date); query += ' AND trade_date = @tradeDate'; }
    const result = await request.query(`${query} ORDER BY created_at DESC`);
    return result.recordset;
  }
}

module.exports = AuditLogRepository;
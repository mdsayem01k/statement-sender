const Db = require('./Db');

// SQL shared by every "notification table" (deposit, payment, BO registration ...).
// Each notification table has: IsSentSms / IsSentEmail, *SentAt, *Error, RetryCount, UrlCode, CellNo, Email.
// A subclass supplies its table DDL (ddl()) and what to join / select for the message.
class NotificationRepository {
  constructor({ table, pk, poolName = 'poolPromise', select = '', join = '', sinceColumn = 'n.InsertDate',
                searchColumns = [], dateColumn = null }) {
    this.table = table;             // 'dbo.ChequeNotification'
    this.bare = table.replace(/^.*\./, '');
    this.pk = pk;                   // primary key column of the notification table
    this.poolName = poolName;
    this.select = select;           // extra columns for the message, e.g. 's.Amount, s.Descriptions'
    this.join = join;               // e.g. 'JOIN dbo.X s ON s.Id = n.Id'
    this.sinceColumn = sinceColumn; // column compared with the "notify since" date
    this.searchColumns = ['n.UrlCode', 'n.CellNo', 'n.Email', ...searchColumns]; // columns the UI search looks in
    this.dateColumn = dateColumn || sinceColumn;                                  // column the UI date filter uses
  }

  // columns every message needs (+ the subclass columns)
  columns() {
    return `n.${this.pk} AS Id, n.UrlCode, n.CellNo, n.Email, n.IsSentSms, n.IsSentEmail, n.RetryCount${this.select ? ', ' + this.select : ''}`;
  }

  pool() { return Db.pool(this.poolName); }

  // CREATE TABLE ... (override in the subclass)
  ddl() { throw new Error(`${this.table}: ddl() not implemented`); }

  async ensureTables() {
    const p = await this.pool();
    await p.request().query(this.ddl());
    await p.request().query(`
IF COL_LENGTH('${this.table}','UrlCode') IS NULL ALTER TABLE ${this.table} ADD UrlCode NVARCHAR(64) NULL;
IF COL_LENGTH('${this.table}','SentChannel') IS NULL ALTER TABLE ${this.table} ADD SentChannel NVARCHAR(20) NULL;`);
    // one row per extra recipient (RM ...) and channel, shared by every notification table
    await p.request().query(`
IF OBJECT_ID('dbo.NotificationRecipient','U') IS NULL
CREATE TABLE dbo.NotificationRecipient (
  RecipientID    INT IDENTITY(1,1) PRIMARY KEY,
  Module         NVARCHAR(60) NOT NULL,   -- notification table name, e.g. ChequeNotification
  NotificationID INT          NOT NULL,
  Role           NVARCHAR(20) NOT NULL,   -- 'RM'
  Channel        NVARCHAR(10) NOT NULL,   -- 'MOBILE' | 'EMAIL'
  IsSent         BIT          NOT NULL DEFAULT 0,
  SentAt         DATETIME     NULL,
  SentChannel    NVARCHAR(20) NULL,       -- WHATSAPP | SMS | EMAIL
  Error          NVARCHAR(300) NULL,
  RetryCount     INT          NOT NULL DEFAULT 0,
  UpdatedAt      DATETIME     NULL,
  CONSTRAINT UQ_NotificationRecipient UNIQUE (Module, NotificationID, Role, Channel)
);`);
    // separate batch: the column must exist before the index is compiled (filtered, so NULL codes don't clash)
    await p.request().query(`
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_${this.bare}_UrlCode' AND object_id = OBJECT_ID('${this.table}'))
  CREATE UNIQUE INDEX UQ_${this.bare}_UrlCode ON ${this.table} (UrlCode) WHERE UrlCode IS NOT NULL;`);
  }

  isDuplicateUrlCode(err) {
    return new RegExp(`UQ_${this.bare}_UrlCode`).test(err.message);
  }

  // SQL for "an extra recipient (RM) still has something to receive". '' = this table has no extra recipients.
  // A subclass returns a predicate; it may use @module, @maxRetry and the table alias n.
  extraPendingSql(/* { emailEnabled } */) { return ''; }

  // rows that still need something sent:
  //   the investor: WhatsApp/SMS (IsSentSms = 0) or email (IsSentEmail = 0), while RetryCount < maxRetry
  //   or an extra recipient (includeRm): see extraPendingSql(), with its own retry count
  async findUnsent({ limit, maxRetry, since, includeRm = false, includeGroup = false, groupSince = null, emailEnabled = true, rmEmailEnabled = false, deliveryModule = null }) {
    const { sql } = Db;
    const p = await this.pool();
    const available = (role, via) => deliveryModule
      ? `AND NOT EXISTS (SELECT 1 FROM dbo.NotificationDelivery d WHERE d.Module = @deliveryModule AND d.NotificationID = CONVERT(NVARCHAR(100), n.${this.pk}) AND d.RecipientRole = '${role}' AND d.Via = '${via}' AND d.State IN ('IN_FLIGHT', 'UNKNOWN', 'SENT'))`
      : '';
    const investor = `n.RetryCount < @maxRetry AND (
        (n.IsSentSms = 0 AND ISNULL(n.CellNo, '') <> '' ${available('INVESTOR', 'MOBILE')})
        ${emailEnabled ? `OR (n.IsSentEmail = 0 AND ISNULL(n.Email, '') <> '' ${available('INVESTOR', 'EMAIL')})` : ''})`;
    const extra = includeRm || includeGroup ? this.extraPendingSql({ emailEnabled, rmEmailEnabled, deliveryModule, includeRm, includeGroup }) : '';
    const r = await p.request()
      .input('limit', sql.Int, limit)
      .input('maxRetry', sql.Int, maxRetry)
      .input('since', sql.DateTime, since)
      .input('module', sql.NVarChar(60), this.bare)
      .input('deliveryModule', sql.NVarChar(160), deliveryModule)
      .input('groupSince', sql.DateTime, groupSince)
      .query(`
${deliveryModule ? "UPDATE dbo.NotificationDelivery SET State = 'UNKNOWN', Error = 'Delivery worker expired; reconcile before retrying.', UpdatedAt = SYSUTCDATETIME() WHERE Module = @deliveryModule AND State = 'IN_FLIGHT' AND LeaseUntil <= SYSUTCDATETIME();" : ''}
SELECT TOP (@limit) ${this.columns()}
FROM ${this.table} n ${this.join}
WHERE n.UrlCode IS NOT NULL
  AND ((${investor}) ${extra ? `OR (${extra})` : ''})
  AND (@since IS NULL OR ${this.sinceColumn} >= @since)
ORDER BY n.${this.pk}`);
    return r.recordset;
  }

  // Set of 'id:role:channel' that are finished (sent, or gave up) for these notification ids
  async doneRecipients(ids, maxRetry) {
    const done = new Set();
    if (!ids.length) return done;
    const { sql } = Db;
    const p = await this.pool();
    const req = p.request().input('module', sql.NVarChar(60), this.bare).input('maxRetry', sql.Int, maxRetry);
    const names = ids.map((id, i) => { req.input(`i${i}`, sql.Int, id); return `@i${i}`; });
    const r = await req.query(`
SELECT NotificationID, Role, Channel FROM dbo.NotificationRecipient
WHERE Module = @module AND NotificationID IN (${names.join(',')}) AND (IsSent = 1 OR RetryCount >= @maxRetry)`);
    r.recordset.forEach((x) => done.add(`${x.NotificationID}:${x.Role}:${x.Channel}`));
    return done;
  }

  async markRecipientSent(id, role, via, channel) {
    const { sql } = Db;
    const p = await this.pool();
    await p.request()
      .input('module', sql.NVarChar(60), this.bare).input('id', sql.Int, id)
      .input('role', sql.NVarChar(20), role).input('via', sql.NVarChar(10), via).input('channel', sql.NVarChar(20), channel)
      .query(`
UPDATE dbo.NotificationRecipient SET IsSent = 1, SentAt = GETDATE(), SentChannel = @channel, Error = NULL, UpdatedAt = GETDATE()
WHERE Module = @module AND NotificationID = @id AND Role = @role AND Channel = @via;
IF @@ROWCOUNT = 0
  INSERT INTO dbo.NotificationRecipient (Module, NotificationID, Role, Channel, IsSent, SentAt, SentChannel)
  VALUES (@module, @id, @role, @via, 1, GETDATE(), @channel);`);
  }

  async markRecipientFailed(id, role, via, message) {
    const { sql } = Db;
    const p = await this.pool();
    await p.request()
      .input('module', sql.NVarChar(60), this.bare).input('id', sql.Int, id)
      .input('role', sql.NVarChar(20), role).input('via', sql.NVarChar(10), via)
      .input('err', sql.NVarChar(300), String(message || '').slice(0, 300))
      .query(`
UPDATE dbo.NotificationRecipient SET Error = @err, RetryCount = RetryCount + 1, UpdatedAt = GETDATE()
WHERE Module = @module AND NotificationID = @id AND Role = @role AND Channel = @via;
IF @@ROWCOUNT = 0
  INSERT INTO dbo.NotificationRecipient (Module, NotificationID, Role, Channel, Error, RetryCount, UpdatedAt)
  VALUES (@module, @id, @role, @via, @err, 1, GETDATE());`);
  }

  // one row, same columns as findUnsent (used by "send now" in the UI)
  async findById(id) {
    const { sql } = Db;
    const p = await this.pool();
    const r = await p.request().input('id', sql.Int, id)
      .query(`SELECT ${this.columns()} FROM ${this.table} n ${this.join} WHERE n.${this.pk} = @id`);
    return r.recordset[0] || null;
  }

  // rows for the "generated links" screen, newest first. date: Date|null, q: text, limit/offset: paging
  async listLinks({ date = null, q = '', limit = 25, offset = 0 }) {
    const { sql } = Db;
    const p = await this.pool();
    const where = `WHERE n.UrlCode IS NOT NULL
      AND (@date IS NULL OR CAST(${this.dateColumn} AS DATE) = @date)
      AND (@q = '' OR ${this.searchColumns.map((c) => `${c} LIKE @like`).join(' OR ')})`;
    const bind = (req) => req
      .input('date', sql.Date, date)
      .input('q', sql.NVarChar(100), q)
      .input('like', sql.NVarChar(120), `%${q}%`);

    const total = (await bind(p.request()).query(`SELECT COUNT(*) AS n FROM ${this.table} n ${this.join} ${where}`)).recordset[0].n;
    const rows = (await bind(p.request())
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset)
      .query(`SELECT ${this.columns()}, n.SmsError, n.EmailError, n.SentChannel, n.SmsSentAt, n.EmailSentAt, n.InsertDate
              FROM ${this.table} n ${this.join} ${where}
              ORDER BY n.${this.pk} DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`)).recordset;
    return { total, rows };
  }

  // backlog for the admin report: waiting for mobile / email, and rows that gave up (RetryCount reached the limit)
  async countPending({ maxRetry, since = null }) {
    const { sql } = Db;
    const p = await this.pool();
    const r = await p.request().input('m', sql.Int, maxRetry).input('since', sql.DateTime, since).query(`
SELECT ISNULL(SUM(CASE WHEN n.IsSentSms = 0 AND ISNULL(n.CellNo,'') <> '' AND n.RetryCount < @m THEN 1 ELSE 0 END), 0) AS mobile,
       ISNULL(SUM(CASE WHEN n.IsSentEmail = 0 AND ISNULL(n.Email,'') <> '' AND n.RetryCount < @m THEN 1 ELSE 0 END), 0) AS email,
       ISNULL(SUM(CASE WHEN n.RetryCount >= @m AND (n.IsSentSms = 0 OR n.IsSentEmail = 0) THEN 1 ELSE 0 END), 0) AS exhausted
FROM ${this.table} n ${this.join}
WHERE n.UrlCode IS NOT NULL AND (@since IS NULL OR ${this.sinceColumn} >= @since)`);
    return r.recordset[0];
  }

  // via: 'MOBILE' (WhatsApp or SMS) | 'EMAIL'.  Either channel counts as sent.
  async markSent(id, via, channel) {
    const { sql } = Db;
    const p = await this.pool();
    const set = via === 'EMAIL'
      ? 'IsSentEmail = 1, EmailSentAt = GETDATE(), EmailError = NULL'
      : 'IsSentSms = 1, SmsSentAt = GETDATE(), SmsError = NULL, SentChannel = @channel';
    await p.request()
      .input('id', sql.Int, id)
      .input('channel', sql.NVarChar(20), channel)
      .query(`UPDATE ${this.table} SET ${set}, UpdatedAt = GETDATE() WHERE ${this.pk} = @id`);
  }

  async markFailed(id, via, message) {
    const { sql } = Db;
    const p = await this.pool();
    const col = via === 'EMAIL' ? 'EmailError' : 'SmsError';
    await p.request()
      .input('id', sql.Int, id)
      .input('err', sql.NVarChar(300), String(message || '').slice(0, 300))
      .query(`UPDATE ${this.table} SET ${col} = @err, RetryCount = RetryCount + 1, UpdatedAt = GETDATE() WHERE ${this.pk} = @id`);
  }

  async findWithoutUrlCode() {
    const p = await this.pool();
    const r = await p.request().query(`SELECT ${this.pk} AS Id FROM ${this.table} WHERE UrlCode IS NULL`);
    return r.recordset;
  }

  async setUrlCode(id, urlCode) {
    const { sql } = Db;
    const p = await this.pool();
    await p.request()
      .input('id', sql.Int, id)
      .input('urlCode', sql.NVarChar(64), urlCode)
      .query(`UPDATE ${this.table} SET UrlCode = @urlCode, UpdatedAt = GETDATE() WHERE ${this.pk} = @id AND UrlCode IS NULL`);
  }
}

module.exports = NotificationRepository;
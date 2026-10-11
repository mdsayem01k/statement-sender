const Db = require('../../core/Db');
const NotificationRepository = require('../../core/NotificationRepository');

// Everything a receipt-type module needs from the database. Deposit (cheque) and Payment share this.
// A subclass only writes fetchNewFromSource(): the query on the OTHER table.
// That query must return these columns (alias them if your table names differ):
//   <idColumn>, InvestorID, InvestorCode, CellNo, Email, ReceiveDate, Amount, Descriptions, ReferenceNumber, SourceInTimestamp
class ReceiptRepository extends NotificationRepository {
  constructor({ syncTable, notificationTable, idColumn, sourcePool }) {
    super({
      table: notificationTable,
      pk: 'NotificationID',
      select: `n.${idColumn} AS SourceId, s.InvestorCode, s.Amount, s.Descriptions, s.ReceiveDate, s.Trader, s.RmMobile, s.RmEmail`,
      join: `JOIN ${syncTable} s ON s.${idColumn} = n.${idColumn}`,
      sinceColumn: 's.ReceiveDate',
      searchColumns: ['s.InvestorCode', 's.Descriptions', 's.ReferenceNumber'],
    });
    this.syncTable = syncTable;
    this.idColumn = idColumn;
    this.sourcePool = sourcePool;   // 'XBpoolPromise' ...
  }

  ddl() {
    const s = this.syncTable, n = this.table, id = this.idColumn;
    return `
IF OBJECT_ID('${s}','U') IS NULL
CREATE TABLE ${s} (
  ${id}             INT            NOT NULL PRIMARY KEY,
  InvestorID        INT            NULL,
  InvestorCode      NVARCHAR(50)   NULL,
  CellNo            NVARCHAR(30)   NULL,
  Email             NVARCHAR(150)  NULL,
  ReceiveDate       DATETIME       NULL,
  Amount            DECIMAL(18,2)  NULL,
  Descriptions      NVARCHAR(500)  NULL,
  ReferenceNumber   NVARCHAR(100)  NULL,
  SourceInTimestamp DATETIME       NULL,
  Trader            NVARCHAR(50)   NULL,
  RmMobile          NVARCHAR(30)   NULL,
  RmEmail           NVARCHAR(150)  NULL,
  SyncedAt          DATETIME       NOT NULL DEFAULT GETDATE()
);

-- table created before RM support: add the columns
IF COL_LENGTH('${s}','Trader')   IS NULL ALTER TABLE ${s} ADD Trader   NVARCHAR(50)  NULL;
IF COL_LENGTH('${s}','RmMobile') IS NULL ALTER TABLE ${s} ADD RmMobile NVARCHAR(30)  NULL;
IF COL_LENGTH('${s}','RmEmail')  IS NULL ALTER TABLE ${s} ADD RmEmail  NVARCHAR(150) NULL;

IF OBJECT_ID('${n}','U') IS NULL
CREATE TABLE ${n} (
  NotificationID INT IDENTITY(1,1) PRIMARY KEY,
  ${id}          INT            NOT NULL,
  InvestorCode   NVARCHAR(50)   NULL,
  CellNo         NVARCHAR(30)   NULL,
  Email          NVARCHAR(150)  NULL,
  UrlCode        NVARCHAR(64)   NULL,
  IsSentSms      BIT            NOT NULL DEFAULT 0,
  SmsSentAt      DATETIME       NULL,
  SmsError       NVARCHAR(300)  NULL,
  IsSentEmail    BIT            NOT NULL DEFAULT 0,
  EmailSentAt    DATETIME       NULL,
  EmailError     NVARCHAR(300)  NULL,
  RetryCount     INT            NOT NULL DEFAULT 0,
  InsertDate     DATETIME       NOT NULL DEFAULT GETDATE(),
  UpdatedAt      DATETIME       NULL,
  CONSTRAINT UQ_${this.bare}_Source UNIQUE (${id})
);`;
  }

  // RM still has a channel to receive: has a number / address and no finished NotificationRecipient row
  extraPendingSql({ emailEnabled = true } = {}) {
    const open = (ch) => `NOT EXISTS (SELECT 1 FROM dbo.NotificationRecipient r
      WHERE r.Module = @module AND r.NotificationID = n.${this.pk} AND r.Role = 'RM' AND r.Channel = '${ch}'
        AND (r.IsSent = 1 OR r.RetryCount >= @maxRetry))`;
    const parts = [`(ISNULL(s.RmMobile, '') <> '' AND ${open('MOBILE')})`];
    if (emailEnabled) parts.push(`(ISNULL(s.RmEmail, '') <> '' AND ${open('EMAIL')})`);
    return parts.join(' OR ');
  }

  /* ---- the only part that differs per module ---- */
  async fetchNewFromSource(/* afterId */) {
    throw new Error(`${this.table}: fetchNewFromSource() not implemented`);
  }

  async getLastSourceId() {
    const p = await this.pool();
    const r = await p.request().query(`SELECT ISNULL(MAX(${this.idColumn}),0) AS id FROM ${this.syncTable}`);
    return r.recordset[0].id;
  }

  async insertSyncRow(row) {
    const { sql } = Db;
    const p = await this.pool();
    const id = this.idColumn;
    const res = await p.request()
      .input('id', sql.Int, row[id])
      .input('InvestorID', sql.Int, row.InvestorID)
      .input('InvestorCode', sql.NVarChar(50), row.InvestorCode)
      .input('CellNo', sql.NVarChar(30), row.CellNo)
      .input('Email', sql.NVarChar(150), row.Email)
      .input('ReceiveDate', sql.DateTime, row.ReceiveDate)
      .input('Amount', sql.Decimal(18, 2), row.Amount)
      .input('Descriptions', sql.NVarChar(500), row.Descriptions)
      .input('ReferenceNumber', sql.NVarChar(100), row.ReferenceNumber)
      .input('SourceInTimestamp', sql.DateTime, row.SourceInTimestamp)
      .input('Trader', sql.NVarChar(50), row.Trader)
      .input('RmMobile', sql.NVarChar(30), row.RmMobile)
      .input('RmEmail', sql.NVarChar(150), row.RmEmail)
      .query(`
IF NOT EXISTS (SELECT 1 FROM ${this.syncTable} WHERE ${id} = @id)
  INSERT INTO ${this.syncTable}
    (${id}, InvestorID, InvestorCode, CellNo, Email, ReceiveDate, Amount, Descriptions, ReferenceNumber, SourceInTimestamp, Trader, RmMobile, RmEmail)
  VALUES
    (@id, @InvestorID, @InvestorCode, @CellNo, @Email, @ReceiveDate, @Amount, @Descriptions, @ReferenceNumber, @SourceInTimestamp, @Trader, @RmMobile, @RmEmail)`);
    return res.rowsAffected[0] || 0;
  }

  // synced rows that have no notification row yet
  async findWithoutNotification() {
    const p = await this.pool();
    const id = this.idColumn;
    const r = await p.request().query(`
SELECT s.${id} AS SourceId, s.InvestorCode, s.CellNo, s.Email
FROM ${this.syncTable} s
LEFT JOIN ${this.table} n ON n.${id} = s.${id}
WHERE n.${id} IS NULL`);
    return r.recordset;
  }

  async insertNotification({ SourceId, InvestorCode, CellNo, Email, UrlCode }) {
    const { sql } = Db;
    const p = await this.pool();
    await p.request()
      .input('id', sql.Int, SourceId)
      .input('InvestorCode', sql.NVarChar(50), InvestorCode)
      .input('CellNo', sql.NVarChar(30), CellNo)
      .input('Email', sql.NVarChar(150), Email)
      .input('UrlCode', sql.NVarChar(64), UrlCode)
      .query(`INSERT INTO ${this.table} (${this.idColumn}, InvestorCode, CellNo, Email, UrlCode)
              VALUES (@id, @InvestorCode, @CellNo, @Email, @UrlCode)`);
  }

  // data for the receipt PDF
  async findReceiptByUrlCode(code) {
    const { sql } = Db;
    const p = await this.pool();
    const id = this.idColumn;
    const r = await p.request().input('code', sql.NVarChar(64), code).query(`
SELECT s.${id} AS SourceId, s.InvestorCode, s.ReceiveDate, s.Amount, s.Descriptions, s.ReferenceNumber
FROM ${this.table} n
JOIN ${this.syncTable} s ON s.${id} = n.${id}
WHERE n.UrlCode = @code`);
    return r.recordset[0] || null;
  }
}

module.exports = ReceiptRepository;
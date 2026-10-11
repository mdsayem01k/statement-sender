const Db = require('../../core/Db');
const NotificationRepository = require('../../core/NotificationRepository');

// "Registration reached step 9" rows, copied from the BO database into our database.
class BoStepRepository extends NotificationRepository {
  constructor() {
    super({
      table: 'dbo.BoStepNotification',
      pk: 'BORegistrationMasterID',
      select: 'n.BORegistrationNo',
      sinceColumn: 'n.StepDate',
    });
  }

  ddl() {
    return `
IF OBJECT_ID('dbo.BoStepNotification','U') IS NULL
CREATE TABLE dbo.BoStepNotification (
  BORegistrationMasterID INT            NOT NULL PRIMARY KEY,
  BORegistrationNo       NVARCHAR(100)  NULL,
  CellNo                 NVARCHAR(30)   NULL,
  Email                  NVARCHAR(150)  NULL,
  UrlCode                NVARCHAR(64)   NULL,
  StepDate               DATETIME       NULL,   -- LastUpdateDate of step 9 in the BO database
  IsSentSms              BIT            NOT NULL DEFAULT 0,
  SmsSentAt              DATETIME       NULL,
  SmsError               NVARCHAR(300)  NULL,
  IsSentEmail            BIT            NOT NULL DEFAULT 0,
  EmailSentAt            DATETIME       NULL,
  EmailError             NVARCHAR(300)  NULL,
  RetryCount             INT            NOT NULL DEFAULT 0,
  InsertDate             DATETIME       NOT NULL DEFAULT GETDATE(),
  UpdatedAt              DATETIME       NULL
);`;
  }

  // one row per registration that reached step 9 (latest step-9 date if logged more than once)
  async fetchStep9FromSource(since) {
    const pool = await Db.pool('BOpoolPromise');
    const r = await pool.request().input('since', Db.sql.DateTime, since).query(`
SELECT m.BORegistrationMasterID, m.BORegistrationNo, m.CellNo, m.Email,
       MAX(l.LastUpdateDate) AS StepDate
FROM dbo.Investor_tblBORegistrationStepsLogs l
JOIN dbo.Investor_tblBORegistrationMaster m ON m.BORegistrationMasterID = l.BORegistrationMasterID
WHERE l.BORegistrationStepID = 9
  AND (@since IS NULL OR l.LastUpdateDate >= @since)
GROUP BY m.BORegistrationMasterID, m.BORegistrationNo, m.CellNo, m.Email
ORDER BY MAX(l.LastUpdateDate)`);
    return r.recordset;
  }

  async getLastStepDate() {
    const p = await this.pool();
    const r = await p.request().query(`SELECT MAX(StepDate) AS d FROM ${this.table}`);
    return r.recordset[0].d || null;
  }

  // 1 if inserted, 0 if it already existed
  async insertRow(row) {
    const { sql } = Db;
    const p = await this.pool();
    const res = await p.request()
      .input('id', sql.Int, row.BORegistrationMasterID)
      .input('no', sql.NVarChar(100), row.BORegistrationNo)
      .input('cell', sql.NVarChar(30), row.CellNo)
      .input('email', sql.NVarChar(150), row.Email)
      .input('urlCode', sql.NVarChar(64), row.UrlCode)
      .input('stepDate', sql.DateTime, row.StepDate)
      .query(`
IF NOT EXISTS (SELECT 1 FROM ${this.table} WHERE BORegistrationMasterID = @id)
  INSERT INTO ${this.table}
    (BORegistrationMasterID, BORegistrationNo, CellNo, Email, UrlCode, StepDate, IsSentSms, IsSentEmail, InsertDate)
  VALUES (@id, @no, @cell, @email, @urlCode, @stepDate, 0, 0, GETDATE())`);
    return res.rowsAffected[0] || 0;
  }
}

module.exports = BoStepRepository;

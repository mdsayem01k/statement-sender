const Db = require('../../core/Db');
const ReceiptRepository = require('../receipt/ReceiptRepository');
const DepositReqRepository = require('../depositReq/ChequeRepository');

class DepositApproveRepository extends ReceiptRepository {
  constructor(settings) {
    super({
      syncTable: 'dbo.DepositApproveSync',
      notificationTable: 'dbo.DepositApproveNotification',
      idColumn: 'ApprovalID',
      sourcePool: 'XBpoolPromise'
    });
    this.settings = settings;
    this.sinceColumn = 's.SourceInTimestamp';
    this.dateColumn = this.sinceColumn;
    this.select += ', s.SourcePaymentID, rm.Whatsapp_group AS RmWhatsappGroup';
    this.join += `
      OUTER APPLY (
        SELECT MIN(NULLIF(LTRIM(RTRIM(r.Whatsapp_group)), '')) AS Whatsapp_group
        FROM dbo.rm_info r
        WHERE r.tradercode = s.Trader
        HAVING COUNT(DISTINCT NULLIF(LTRIM(RTRIM(r.Whatsapp_group)), '')) <= 1
      ) rm`;
  }

  ddl() {
    return super.ddl().replace(
      /ApprovalID\s+INT\s+NOT NULL PRIMARY KEY/,
      `ApprovalID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       SourcePaymentID NVARCHAR(100) NOT NULL,
       CONSTRAINT UQ_DepositApproveSync_Source UNIQUE (SourcePaymentID)`
    );
  }

  async fetchNewFromSource() {
    const source = await Db.pool(this.sourcePool);
    const result = await source.request()
      .input('since', Db.sql.VarChar(19), this.settings.syncSince)
      .query(`
        DECLARE @businessDate DATE = (
          SELECT DATEADD(DAY, 1, MAX(EODDate))
          FROM dbo.EOD_tblInvestorPortfolioValuesByDate
        );
        IF @businessDate IS NULL
          THROW 50010, 'DepositApprove: EOD business date is missing.', 1;
        SELECT CONVERT(NVARCHAR(100), p.paymentID) AS SourcePaymentID,
          p.InvestorID, i.InvestorCode, i.CellNo, i.Email,
          t.USERID AS Trader, p.PaymentDate AS ReceiveDate,
          p.PaymentDate AS SourceInTimestamp, p.Amount,
          CONCAT('Payment mode: ', pm.PayModeName) AS Descriptions,
          CONVERT(NVARCHAR(100), p.paymentID) AS ReferenceNumber
        FROM dbo.Payments_tblInvestorPayments p
        JOIN dbo.Setup_tblInvestor i ON i.InvestorID = p.InvestorID
        JOIN dbo.Payments_tblPayMode pm ON pm.PayModeID = p.PayModeID
        LEFT JOIN dbo.Trade_tblTraderList t ON t.TRADERID = i.TraderID
        WHERE p.PaymentDate >= CONVERT(DATETIME2, @since, 126)
          AND p.PaymentDate < DATEADD(DAY, 1, @businessDate)
          AND p.PaymentTypeID = 1
          AND p.PayModeID NOT IN (4, 8)
        ORDER BY p.PaymentDate, p.paymentID;`);
    const rows = result.recordset;
    const seen = new Set();
    const local = await this.pool();
    for (let start = 0; start < rows.length; start += 500) {
      const batch = rows.slice(start, start + 500);
      const request = local.request();
      const names = batch.map((row, index) => {
        request.input(`p${index}`, Db.sql.NVarChar(100), String(row.SourcePaymentID));
        return `@p${index}`;
      });
      const existing = await request.query(`
        SELECT SourcePaymentID FROM ${this.syncTable}
        WHERE SourcePaymentID IN (${names.join(',')});`);
      for (const row of existing.recordset) seen.add(String(row.SourcePaymentID));
    }
    return rows.filter(row => !seen.has(String(row.SourcePaymentID)));
  }

  async insertSyncRow(row) {
    const pool = await this.pool();
    const { sql } = Db;
    const result = await pool.request()
      .input('source', sql.NVarChar(100), String(row.SourcePaymentID))
      .input('investorId', sql.Int, row.InvestorID)
      .input('code', sql.NVarChar(50), row.InvestorCode)
      .input('mobile', sql.NVarChar(30), String(row.CellNo || '').split(',')[0].trim() || null)
      .input('email', sql.NVarChar(150), String(row.Email || '').split(',')[0].trim() || null)
      .input('date', sql.DateTime, row.ReceiveDate)
      .input('amount', sql.Decimal(18, 2), row.Amount)
      .input('description', sql.NVarChar(500), row.Descriptions)
      .input('trader', sql.NVarChar(50), row.Trader)
      .query(`
        INSERT INTO ${this.syncTable}
          (SourcePaymentID, InvestorID, InvestorCode, CellNo, Email,
           ReceiveDate, SourceInTimestamp, Amount, Descriptions, ReferenceNumber, Trader)
        SELECT @source, @investorId, @code, @mobile, @email,
          @date, @date, @amount, @description, @source, @trader
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.syncTable} WITH (UPDLOCK, HOLDLOCK)
          WHERE SourcePaymentID = @source
        );`);
    return result.rowsAffected[0] || 0;
  }

  findUnsent(options) {
    return DepositReqRepository.prototype.findUnsent.call(this, options);
  }
}

module.exports = DepositApproveRepository;

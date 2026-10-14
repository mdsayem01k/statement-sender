const Db = require('../../core/Db');
const ReceiptRepository = require('../receipt/ReceiptRepository');
const RmRepository = require('../rm/RmRepository');

const norm = (v) => String(v ?? '').trim().toUpperCase();

// Deposit = Payments_tblDepositRequisition. Existing table names are kept.
class ChequeRepository extends ReceiptRepository {
  constructor() {
  super({
    syncTable: 'dbo.WithdrawalRequest_Sync',
    notificationTable: 'dbo.WithdrawalRequestNotification',
    idColumn: 'RequisitionID',
    sourcePool: 'BOpoolPromise'
  });

  this.rmRepo = new RmRepository();
}

  async fetchNewFromSource(afterId) {
  const since = String(
    process.env.PAYMENT_SYNC_SINCE || ''
  ).trim();

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(since)
  ) {
    throw new Error(
      'Set PAYMENT_SYNC_SINCE to YYYY-MM-DDTHH:mm:ss just before the first unsent withdrawal request.'
    );
  }

  const { sql } = Db;
  const pool = await Db.pool(this.sourcePool);
 

  const result = await pool.request()
    .input('last', sql.Int, afterId)
    .input('since', sql.VarChar(19), since)
    .query(`
      SELECT
        d.RecordID AS RequisitionID,
        d.InvestorID,
        d.InvestorCode,
        d.RequisitionDate AS ReceiveDate,
        d.RequisitionAmount AS Amount,
        'WITHDRAWAL REQUEST' AS Descriptions,
        NULL AS ReferenceNumber,
        d.InTimeStamp AS SourceInTimestamp
      FROM dbo.Payments_tblPaymentRequsition d
      WHERE d.RecordID > @last
        AND COALESCE(d.InTimeStamp, d.RequisitionDate)
            >= CONVERT(DATETIME2, @since, 126)
      ORDER BY d.RecordID
    `);

  console.log('[PAYMENT SOURCE]', {
    sourcePool: this.sourcePool,
    sourceTable: 'dbo.Payments_tblPaymentRequsition',
    lastId: afterId,
    since,
    fetched: result.recordset.length
  });

  const enriched = await this.attachInvestorInfo(
    result.recordset
  );

  return this.rmRepo.attach(enriched);
}

  // investor code -> CellNo, Email, Trader, from the XB database
  async attachInvestorInfo(rows) {
    const empty = { CellNo: null, Email: null, Trader: null };
    const codes = [...new Set(rows.map((x) => x.InvestorCode).filter(Boolean))];
    if (!codes.length) return rows.map((x) => ({ ...x, ...empty }));

    const p = await Db.pool('XBpoolPromise');
    const map = new Map();
    for (let i = 0; i < codes.length; i += 500) {
      const req = p.request();
      const names = codes.slice(i, i + 500).map((c, j) => {
        req.input(`c${j}`, Db.sql.NVarChar(50), c);
        return `@c${j}`;
      });
      const { recordset } = await req.query(
        `SELECT i.InvestorCode, i.CellNo, i.Email, t.UserID AS Trader
         FROM dbo.Setup_tblInvestor i
         LEFT JOIN dbo.Trade_tblTraderList t ON t.TRADERID = i.TraderID
         WHERE i.InvestorCode IN (${names.join(',')})`);
      recordset.forEach((x) => map.set(norm(x.InvestorCode), x));
    }
    return rows.map((x) => {
      const info = map.get(norm(x.InvestorCode));
      return {
        ...x,
        CellNo: info?.CellNo || null,
        Email: info?.Email || null,
        Trader: info?.Trader || null,
      };
    });
  }
}

module.exports = ChequeRepository;
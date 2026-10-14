const Db = require('../../core/Db');
const ReceiptRepository = require('../receipt/ReceiptRepository');
const RmRepository = require('../rm/RmRepository');

const norm = (v) => String(v ?? '').trim().toUpperCase();

// Deposit = Payments_tblDepositRequisition. Existing table names are kept.
class ChequeRepository extends ReceiptRepository {
  constructor() {
    super({
      syncTable: 'dbo.DepositReq_sync',
      notificationTable: 'dbo.depositReqNotification',
      idColumn: 'ChequeID',
      sourcePool: 'BOpoolPromise',          // same DB as Payments_tblPaymentRequsition. Change if wrong.
    });
    this.rmRepo = new RmRepository();
  }

  async fetchNewFromSource(afterId) {
    const { sql } = Db;
    const p = await Db.pool(this.sourcePool);
    const r = await p.request().input('last', sql.Int, afterId).query(`
SELECT d.RecordID AS ChequeID,                -- <-- replace RecordID with the real id column
       d.InvestorID, d.InvestorCode, d.InvestorName,
       d.ReceiveDate, d.Amount,
       'BO PORTAL' AS Descriptions,
       NULL AS ReferenceNumber,
       d.InTimeStamp AS SourceInTimestamp
FROM dbo.Payments_tblDepositRequisition d
WHERE d.RecordID > @last                      -- <-- same id column
ORDER BY d.RecordID`);

    const enriched = await this.attachInvestorInfo(r.recordset);  // XB: CellNo, Email, Trader
    return this.rmRepo.attach(enriched);                          // poolPromise: RmMobile, RmEmail
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
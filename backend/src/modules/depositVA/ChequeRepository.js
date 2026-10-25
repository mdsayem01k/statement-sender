const Db = require('../../core/Db');
const ReceiptRepository = require('../receipt/ReceiptRepository');
const RmRepository = require('../rm/RmRepository');

// Deposit = cheque payments. Existing table names are kept, so your current data keeps working.
class ChequeRepository extends ReceiptRepository {
  constructor() {
    super({
      syncTable: 'dbo.ChequePayments_Sync',
      notificationTable: 'dbo.ChequeNotification',
      idColumn: 'ChequeID',
      sourcePool: 'XBpoolPromise',
    });
    this.rm = new RmRepository();
  }

  // the ONE query that differs: where deposits come from
  async fetchNewFromSource(afterId) {
    const { sql } = Db;
    const p = await Db.pool(this.sourcePool);
    const r = await p.request().input('last', sql.Int, afterId).query(`
SELECT p.ChequeID, p.investorID AS InvestorID,
       i.InvestorCode, i.CellNo, i.Email,
       t.USERID AS Trader,
       p.ReceiveDate, p.amount AS Amount, p.Descriptions,
       p.ReferenceNumber, p.inTimestamp AS SourceInTimestamp
FROM Payments_tblChequePayments p
LEFT JOIN Setup_tblInvestor i ON i.investorID = p.investorID
LEFT JOIN dbo.Trade_tblTraderList t ON t.TRADERID = i.TraderID
WHERE p.VoucherNo_Prefix LIKE '%API%'
  AND p.ChequeID > @last
ORDER BY p.ChequeID`);
    return this.rm.attach(r.recordset);   // adds RmMobile / RmEmail
  }
}

module.exports = ChequeRepository;
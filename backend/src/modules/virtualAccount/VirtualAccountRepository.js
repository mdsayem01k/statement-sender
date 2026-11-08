const Db = require('../../core/Db');

class VirtualAccountRepository {
  async findByCode(code) {
    const pool = await Db.pool('XBpoolPromise');
    const result = await pool.request()
      .input('code',Db.sql.VarChar(50),code)
      .query(`SELECT TOP (2)
          InvestorCode AS investorCode,
          virtualbankaccountNo AS accountNumber
        FROM dbo.Setup_tblInvestor
        WHERE InvestorCode=@code`);
    if (result.recordset.length > 1) {
      throw new Error('Multiple investor records match this code');
    }
    return result.recordset[0] || null;
  }
}

module.exports = VirtualAccountRepository;

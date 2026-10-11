// Reads one BO registration (all its tables) from the BO database.
const Db = require('../../core/Db');

const TABLES = {
  master:  'dbo.Investor_tblBORegistrationMaster',
  basic:   'dbo.Investor_tblBOInvestorBasicInfo',
  other:   'dbo.Investor_tblBOInvestorOtherInfo',
  address: 'dbo.Investor_tblBOInvestorAddressInfo',
  bank:    'dbo.Investor_tblBOInvestorBankInfo',
  nominee: 'dbo.Investor_tblBOInvestorNomineeInfo',
  payment: 'dbo.Investor_tblBOPaymentInfo',
};

// ID -> name lookups (they live in the XB database)
const LOOKUPS = {
  bank:    'SELECT BankName       AS name FROM Setup_tblBank       WHERE BankID = @id',
  branch:  'SELECT BankBranchName AS name FROM Setup_tblBankBranch WHERE BankBranchID = @id',
  country: 'SELECT CountryName    AS name FROM Setup_tblCountry    WHERE CountryID = @id',
  state:   'SELECT StateName      AS name FROM Setup_tblState      WHERE StateID = @id',
  city:    'SELECT CityName       AS name FROM Setup_tblCity       WHERE CityID = @id',
};

class BoRegistrationRepository {
  async selectByMasterId(table, id) {
    const pool = await Db.pool('BOpoolPromise');
    const r = await pool.request().input('id', Db.sql.Int, id)
      .query(`SELECT * FROM ${table} WHERE BORegistrationMasterID = @id`);
    return r.recordset;
  }

  async findApplicationRows(id) {
    const [master, basic, other, address, bank, nominees, payments] = await Promise.all(
      ['master', 'basic', 'other', 'address', 'bank', 'nominee', 'payment'].map((k) => this.selectByMasterId(TABLES[k], id))
    );
    return {
      master: master[0] || null, basic: basic[0] || null, other: other[0] || null,
      address: address[0] || null, bank: bank[0] || null, nominees, payment: payments[0] || null,
    };
  }

  async lookupName(kind, id) {
    if (id == null || id === '') return '';
    try {
      const pool = await Db.pool('XBpoolPromise');
      const r = await pool.request().input('id', Db.sql.Int, Number(id)).query(LOOKUPS[kind]);
      return r.recordset[0]?.name ?? '';
    } catch (err) {
      console.warn(`[LOOKUP:${kind}] skipped: ${err.message}`);
      return '';
    }
  }

  // url code (stored by the step-9 sync, in OUR database) -> BORegistrationMasterID
  async findMasterIdByUrlCode(urlcode) {
    const pool = await Db.pool('poolPromise');
    const r = await pool.request().input('urlcode', Db.sql.VarChar(100), urlcode)
      .query('SELECT BORegistrationMasterID AS id FROM BoStepNotification WHERE UrlCode = @urlcode');
    return r.recordset[0]?.id ?? null;
  }

  async findMasterIdByBoId(boid) {
    const pool = await Db.pool('BOpoolPromise');
    const r = await pool.request().input('boid', Db.sql.VarChar(100), boid)
      .query(`SELECT BORegistrationMasterID AS id FROM ${TABLES.master} WHERE BOID = @boid`);
    return r.recordset[0]?.id ?? null;
  }
}

module.exports = BoRegistrationRepository;

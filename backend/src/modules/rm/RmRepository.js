const Db = require('../../core/Db');
const norm = (v) => String(v ?? '').trim().toUpperCase();   // 'ab12 ' and 'AB12' must match

class RmRepository {
  async attach(rows) {
    const codes = [...new Set(rows.map((r) => r.Trader).filter(Boolean))];
    if (!codes.length) return rows.map((r) => ({ ...r, RmMobile: null, RmEmail: null }));
    const map = await this.findByTraders(codes);
    return rows.map((r) => {
      const rm = map.get(norm(r.Trader));
      return { ...r, RmMobile: rm?.mobile || null, RmEmail: rm?.email || null };
    });
  }

  // one query per 500 codes (SQL Server allows 2100 parameters per query)
  async findByTraders(codes) {
    const p = await Db.pool('poolPromise');
    const map = new Map();
    console.log('call rm query');
    for (let i = 0; i < codes.length; i += 500) {
      const req = p.request();
      const names = codes.slice(i, i + 500).map((c, j) => { req.input(`t${j}`, Db.sql.NVarChar(50), c); return `@t${j}`; });
      const { recordset } = await req.query(
        `SELECT tradercode, mobile, email FROM dbo.rm_info WHERE tradercode IN (${names.join(',')})`);
      recordset.forEach((x) => map.set(norm(x.tradercode), x));
    }
    return map;
  }
}

module.exports = RmRepository;
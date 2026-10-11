const db = require('../config/database');

// One helper for every repository (replaces the copies of getPool/pool in each model).
class Db {
  static get sql() { return db.sql; }

  // name: 'poolPromise' (our DB) | 'BOpoolPromise' (BO DB) | 'XBpoolPromise' (XB DB)
  static async pool(name = 'poolPromise') {
    if (!db[name]) throw new Error(`config/database.js does not export ${name}. Found: ${Object.keys(db).join(', ')}`);
    const pool = await db[name];
    if (!pool) throw new Error(`${name} resolved to undefined (the .then(pool => ...) must return pool)`);
    return pool;
  }
}

module.exports = Db;

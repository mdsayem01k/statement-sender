const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrongPassword123!',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'PortfolioDB',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
  }
};

const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then(pool => {
    console.log('[DATABASE] Connected to MSSQL Server');
    return pool;
  })
  .catch(err => {
    console.error('[DATABASE ERROR] Connection Failed:', err.message);
    process.exit(1);
  });


const BOdbConfig = {
  user: process.env.BO_DB_USER || 'sa',
  password: process.env.BO_DB_PASSWORD || 'YourStrongPassword123!',
  server: process.env.BO_DB_SERVER || 'localhost',
  database: process.env.BO_DB_NAME || 'PortfolioDB',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
  }
};

const BOpoolPromise = new sql.ConnectionPool(BOdbConfig)
  .connect()
  .then(pool => {
    console.log('[DATABASE_BO] Connected to MSSQL Server');
    return pool;
  })
  .catch(err => {
    console.error('[BO DATABASE ERROR] Connection Failed:', err.message);
    process.exit(1);
  });


  const XBdbConfig = {
  user: process.env.XB_DB_USER || 'sa',
  password: process.env.XB_DB_PASSWORD || 'YourStrongPassword123!',
  server: process.env.XB_DB_SERVER || 'localhost',
  database: process.env.XB_DB_NAME || 'PortfolioDB',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
  }
};

const XBpoolPromise = new sql.ConnectionPool(XBdbConfig)
  .connect()
  .then(pool => {
    console.log('[DATABASE_XB] Connected to MSSQL Server');
    return pool;
  })
  .catch(err => {
    console.error('[XB DATABASE ERROR] Connection Failed:', err.message);
    process.exit(1);
  });
module.exports = {
  sql,
  poolPromise,
  BOpoolPromise,
  XBpoolPromise
};

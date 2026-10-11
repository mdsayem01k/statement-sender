const path = require('path');
const env = require('./env');

// same base as before: two levels above /config
const ROOT = path.join(__dirname, '../..');

module.exports = {
  // trade confirmation PDFs
  NETWORK_PDF_DIR: env.network.pdfShareDir,
  LOCAL_PDF_ROOT: path.join(ROOT, 'storage/pdfs'),

  // portfolio PDFs (different folder, same logic)
  PORTFOLIO_NETWORK_DIR: env.network.portfolioShareDir,
  PORTFOLIO_LOCAL_ROOT: path.join(ROOT, 'storage/portfolio'),

  // BO application PDFs generated on demand
  BO_PDF_DIR: path.resolve(process.env.BO_PDF_DIR || path.join(ROOT, 'storage/bo-pdfs')),

  PUBLIC_DIR: path.join(ROOT, 'public'),
};

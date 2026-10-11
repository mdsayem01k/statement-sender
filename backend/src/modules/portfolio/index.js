const FolderPdfModule = require('../folderPdf/FolderPdfModule');
const PdfLocator = require('../folderPdf/PdfLocator');
const paths = require('../../config/paths');

// Portfolio = the same class as trade confirmation, only the folder (and file prefix) differ.
// Env: PORTFOLIO_PDF_SHARE=<network folder>   (falls back to NETWORK_PDF_SHARE)
class PortfolioModule extends FolderPdfModule {
  constructor(ctx) {
    super({
      ctx,
      type: 'PORTFOLIO',
      label: 'Portfolio',
      linkTemplate: '/api/report/portfolio?BOID={code}',
      pdfRoutes: ['/report/portfolio'],
      auditPrefix: 'PORTFOLIO_',
      adminPrefix: '/portfolio',
      notifyRoute: '/notify/portfolio',
      locator: new PdfLocator({
        networkDir: paths.PORTFOLIO_NETWORK_DIR,
        localRoot: paths.PORTFOLIO_LOCAL_ROOT,
        filePrefix: process.env.PORTFOLIO_FILE_PREFIX || 'Portfolio_',
      }),
    });
  }
}

module.exports = PortfolioModule;

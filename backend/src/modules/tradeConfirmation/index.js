const FolderPdfModule = require('../folderPdf/FolderPdfModule');
const PdfLocator = require('../folderPdf/PdfLocator');
const paths = require('../../config/paths');

// Trade confirmation = a FolderPdfModule with these folder settings. Nothing else.
class TradeConfirmationModule extends FolderPdfModule {
  constructor(ctx) {
    super({
      ctx,
      type: 'TRADE_CONFIRMATION',
      label: 'Trade Confirmation',
      linkTemplate: '/api/report/pdf?BOID={code}',          // same link as before: old messages keep working
      pdfRoutes: ['/report/pdf'],
      adminPrefix: '/report',
      notifyRoute: '/notify/trade-confirmation',
      generateRoute: '/portfoliomap/generate',
      legacy: { urls: '/report/portfolio-urls', send: '/send', mail: '/mail/trade-confirmation' },
      urlBase: ctx.env.app.statementsBaseUrl,
      locator: new PdfLocator({
        networkDir: paths.NETWORK_PDF_DIR,
        localRoot: paths.LOCAL_PDF_ROOT,
        filePrefix: 'ConfirmationNote_',
      }),
    });
  }
}

module.exports = TradeConfirmationModule;

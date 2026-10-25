const ReceiptModule = require('../receipt/ReceiptModule');
const ChequeRepository = require('./ChequeRepository');
const DeliveryLedger = require('../../services/DeliveryLedger');
const DepositVANotificationJob = require('./DepositVANotificationJob');
const DepositVAMessageCenter = require('./DepositVAMessageCenter');
const { config } = require('./config');

class DepositVAModule extends ReceiptModule {
  constructor(ctx) {
    const settings = config();

    const messageCenter = new DepositVAMessageCenter(
      ctx.messageCenter,
      settings
    );

    super({
      ctx: {
        ...ctx,
        messageCenter
      },
      type: 'RECEIPTVA',
      label: 'Deposit VA',
      linkTemplate: '/api/report/receipt/id={code}',
      pdfRoutes: [
        '/report/receipt/:param',
        '/report/receipt'
      ],
      auditPrefix: 'RECEIPTVA_',
      repository: new ChequeRepository(settings),
      tranType: 'VA DEPOSIT',
      jobClass: DepositVANotificationJob,
      job: {
        settings,
        deliveryLedger: new DeliveryLedger({
          poolName: 'poolPromise',
          module: 'RECEIPT:dbo.ChequeNotification'
        })
      }
    });
  }
}

module.exports = DepositVAModule;
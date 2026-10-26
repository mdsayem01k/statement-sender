const ReceiptModule = require('../receipt/ReceiptModule');
const ChequeRepository = require('./ChequeRepository');
const DeliveryLedger = require('../../services/DeliveryLedger');
const DepositReqNotificationJob = require('./DepositReqNotificationJob');
const DepositReqMessageCenter = require('./DepositReqMessageCenter');
const { config } = require('./config');

class DepositReqModule extends ReceiptModule {
  constructor(ctx) {
    const settings = config();
    const messageCenter = new DepositReqMessageCenter(ctx.messageCenter, settings);
    super({
      ctx: { ...ctx, messageCenter },
      type: 'RECEIPTREQ',
      label: 'Deposit Requisition',
      linkTemplate: '/api/report/receipt_req/id={code}',
      auditPrefix: 'RECEIPTREQ_',
      repository: new ChequeRepository(settings),
      jobClass: DepositReqNotificationJob,
      job: {
        settings,
        deliveryLedger: new DeliveryLedger({
          poolName: 'poolPromise',
          module: 'RECEIPTREQ:dbo.depositReqNotification'
        })
      }
    });
  }
}

module.exports = DepositReqModule;

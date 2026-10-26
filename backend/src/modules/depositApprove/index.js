const Repository = require('./DepositApproveRepository');
const Job = require('./DepositApproveJob');
const MessageCenter = require('../depositReq/DepositReqMessageCenter');
const DeliveryLedger = require('../../services/DeliveryLedger');
const { config } = require('./config');

class DepositApproveModule {
  constructor(ctx) {
    this.type = 'DEPOSIT_APPROVE';
    const settings = config();
    this.repository = new Repository(settings);
    this.job = new Job({
      name: this.type,
      type: this.type,
      settings,
      repository: this.repository,
      ctx: { ...ctx, messageCenter: new MessageCenter(ctx.messageCenter, settings) },
      link: () => '',
      deliveryLedger: new DeliveryLedger({
        poolName: 'poolPromise',
        module: 'DEPOSIT_APPROVE:dbo.DepositApproveNotification'
      })
    });
  }

  routes() {
    return [{
      method: 'get',
      path: '/deposit-approve/notifications',
      handler: async (req, res) => {
        const limit = Number(req.query.limit || 25);
        const offset = Number(req.query.offset || 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200 ||
            !Number.isInteger(offset) || offset < 0) {
          return res.status(400).json({ success: false, message: 'Invalid pagination' });
        }
        await this.repository.ensureTables();
        const result = await this.repository.listLinks({
          q: String(req.query.q || '').slice(0, 100), limit, offset
        });
        res.json({ success: true, ...result });
      }
    }];
  }
}

module.exports = DepositApproveModule;

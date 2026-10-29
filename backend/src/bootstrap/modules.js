// ============================================================
//  THE ONE PLACE where modules are plugged in.
//  Add a module = create its folder under /modules, then add ONE line below.
// ============================================================
const ModuleRegistry = require('../core/ModuleRegistry');

const TradeConfirmationModule = require('../modules/tradeConfirmation');
const PortfolioModule = require('../modules/portfolio');
const DepositReqModule=require('../modules/depositReq')
const DepositVAModule = require('../modules/depositVA');
const BoRegistrationModule = require('../modules/boRegistration');
const PaymentModule = require('../modules/payment');   // example: same receipt, other table
const DepositApproveModule = require('../modules/depositApprove');
const CityAgentModule = require('../modules/cityAgent');

function buildRegistry(ctx) {
  const registry = new ModuleRegistry()
    .register(new TradeConfirmationModule(ctx))
    // .register(new PortfolioModule(ctx))
    .register(new DepositReqModule(ctx))
    // .register(new DepositVAModule(ctx))
    .register(new BoRegistrationModule(ctx))
    .register(new PaymentModule(ctx));
  // if (String(process.env.CITYAGENT_ENABLED || '').toLowerCase() === 'true') {
  //   registry.register(new CityAgentModule(ctx));
  // }
  const approveEnabled = String(process.env.DEPOSITAPPROVE_ENABLED || 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(approveEnabled)) {
    throw new Error('DEPOSITAPPROVE_ENABLED must be true or false');
  }
  if (approveEnabled === 'true') registry.register(new DepositApproveModule(ctx));
  return registry;
}

module.exports = buildRegistry;

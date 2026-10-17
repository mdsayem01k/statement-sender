// ============================================================
//  THE ONE PLACE where modules are plugged in.
//  Add a module = create its folder under /modules, then add ONE line below.
// ============================================================
const ModuleRegistry = require('../core/ModuleRegistry');

const TradeConfirmationModule = require('../modules/tradeConfirmation');
const PortfolioModule = require('../modules/portfolio');
const DepositReqModule=require('../modules/depositReq')
const DepositModule = require('../modules/deposit');
const BoRegistrationModule = require('../modules/boRegistration');
const PaymentModule = require('../modules/payment');   // example: same receipt, other table
const CityAgentModule = require('../modules/cityAgent');

function buildRegistry(ctx) {
  const registry = new ModuleRegistry()
    // .register(new TradeConfirmationModule(ctx))
    // .register(new PortfolioModule(ctx))
    // .register(new DepositReqModule(ctx))
    // .register(new DepositModule(ctx))
    // .register(new BoRegistrationModule(ctx))
    // .register(new PaymentModule(ctx));
  if (String(process.env.CITYAGENT_ENABLED || '').toLowerCase() === 'true') {
    registry.register(new CityAgentModule(ctx));
  }
  return registry;
}

module.exports = buildRegistry;

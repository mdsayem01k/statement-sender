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

function buildRegistry(ctx) {
  return new ModuleRegistry()
    // .register(new TradeConfirmationModule(ctx))
    // .register(new PortfolioModule(ctx))
    // .register(new DepositReqModule(ctx))
    // .register(new DepositModule(ctx))
    .register(new BoRegistrationModule(ctx));
    // .register(new PaymentModule(ctx));                  // <- uncomment to switch Payment on
}

module.exports = buildRegistry;

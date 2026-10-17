const CityAgentMessageCenter = require('./CityAgentMessageCenter');
const Repository = require('./CityAgentRepository');
const Job = require('./CityAgentJob');
const { config } = require('./config');

class CityAgentModule {
  constructor(ctx) {
  this.type = 'CITYAGENT';

  const settings = config();

  this.repository = new Repository(settings);

  const messageCenter = new CityAgentMessageCenter(
    ctx.messageCenter,
    settings
  );

  this.job = new Job({
    repository: this.repository,
    ctx: {
      ...ctx,
      messageCenter
    },
    intervalMin: settings.intervalMin,
    mobileEnabled: settings.mobileEnabled,
    emailEnabled: settings.emailEnabled
  });
}

  routes() {
    return [{ method: 'get', path: '/city-agent/notifications', handler: async (req, res) => {
      const pool = await this.repository.pool();
      const result = await pool.request().query(`SELECT TOP (200) n.NotificationID,n.BORegistrationMasterID,n.InvestorCode,n.BoNumber,n.AgentRefCode,
        n.SourceInTimestamp,n.InsertDate,v.Role,v.Via AS Channel,r.IsSent,r.RetryCount,r.Error,
        d.State AS DeliveryState,d.Error AS DeliveryError
        FROM dbo.CityAgentNotification n
        CROSS APPLY (VALUES ('AGENT','MOBILE'),('AGENT','EMAIL'),('CITYBANK','MOBILE'),('CITYBANK','EMAIL')) v(Role,Via)
        LEFT JOIN dbo.NotificationRecipient r ON r.Module='CityAgentNotification' AND r.NotificationID=n.NotificationID AND r.Role=v.Role AND r.Channel=v.Via
        LEFT JOIN dbo.NotificationDelivery d ON d.Module='CITYAGENT:dbo.CityAgentNotification'
          AND d.NotificationID=CONVERT(NVARCHAR(100),n.NotificationID) AND d.RecipientRole=v.Role AND d.Via=v.Via
        ORDER BY n.NotificationID DESC`);
      res.json({ success: true, rows: result.recordset });
    }}];
  }
}
module.exports = CityAgentModule;

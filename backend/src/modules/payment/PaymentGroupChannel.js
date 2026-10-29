const axios = require('axios');
const Channel = require('../../channels/Channel');
const whatsappRequest = require('./whatsappRequest');

class PaymentGroupChannel extends Channel {
  constructor(config, settings) {
    super('WHATSAPP_GROUP');

    this.config = config;
    this.settings = settings;
  }

  accepts(recipient) {
    return (
      recipient.role === 'DEMO_GROUP' &&
      Boolean(this.settings.testGroup) &&
      (this.settings.rmGroupEnabled || this.settings.groupEnabled || this.settings.csdGroupEnabled)
    ) || (
      recipient.role === 'RM_GROUP' &&
      this.settings.rmGroupEnabled
    ) || (
      recipient.role === 'CSD' &&
      this.settings.csdGroupEnabled
    ) || (
      recipient.role === 'FINACC' &&
      this.settings.groupEnabled
    );
  }

  async send({ type, recipient, text }) {
    if (type !== (this.settings.messageType || 'PAYMENT') || !this.accepts(recipient)) {
      const error = new Error(
        'Unsupported Withdrawal Request group recipient'
      );

      error.definitelyNotSent = true;

      throw error;
    }

    const first = (...values) => values.map(value => String(value || '').trim()).find(Boolean) || '';
    const isRmGroup = recipient.role === 'RM_GROUP';
    const isDemoGroup = recipient.role === 'DEMO_GROUP';
    const isCsd = recipient.role === 'CSD';
    const groupName = isDemoGroup
      ? first(this.settings.testGroup)
      : isCsd
        ? first(this.settings.csdGroupName)
        : isRmGroup
        ? first(recipient.groupName)
        : first(this.config.AccgroupName, 'Cbl Finance & IT');
    const sessionId = first(
      isDemoGroup ? this.settings.testGroupSessionId :
        isCsd ? this.settings.csdGroupSessionId :
        isRmGroup ? this.settings.rmGroupSessionId : this.settings.financeGroupSessionId,
      this.config.groupSessionId,
      this.config.sessionId,
      'BT'
    );
    const baseUrl = String(this.config.baseUrl || '').trim().replace(/\/+$/, '');

    if (!baseUrl || !groupName) {
      const error = new Error(
        'Withdrawal Request group configuration is missing'
      );

      error.definitelyNotSent = true;

      throw error;
    }

    return whatsappRequest(
      axios,
      `${baseUrl}/BT/api/whatsapp/send-text-to-group`,
      { sessionId, groupName, message: text },
      { timeout: this.config.timeoutMs }
    );
  }
}

module.exports = PaymentGroupChannel;

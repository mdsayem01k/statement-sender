const axios = require('axios');
const Channel = require('../../channels/Channel');

class DepositVAGroupChannel extends Channel {
  constructor(config, settings) {
    super('WHATSAPP_GROUP');

    this.config = config;
    this.settings = settings;
  }

  accepts(recipient) {
    return (
      recipient.role === 'RM_GROUP' &&
      this.settings.rmGroupEnabled
    ) || (
      recipient.role === 'FINACC' &&
      this.settings.groupEnabled
    );
  }

  async send({ type, recipient, text }) {
    if (type !== 'RECEIPTVA' || !this.accepts(recipient)) {
      const error = new Error(
        'Unsupported Deposit VA group recipient'
      );

      error.definitelyNotSent = true;

      throw error;
    }

    const isRmGroup = recipient.role === 'RM_GROUP';

    const groupName = isRmGroup
      ? String(recipient.groupName || '').trim()
      : this.config.AccgroupName || 'Cbl Finance & IT';

    const sessionId = isRmGroup
      ? this.settings.rmGroupSessionId ||
        this.config.groupSessionId ||
        'it'
      : this.config.groupSessionId || 'it';

    if (!this.config.baseUrl || !groupName) {
      const error = new Error(
        'Deposit VA group configuration is missing'
      );

      error.definitelyNotSent = true;

      throw error;
    }

    const response = await axios.post(
      `${this.config.baseUrl}/BT/api/whatsapp/send-text-to-group`,
      {
        sessionId,
        groupName,
        message: text
      },
      {
        timeout: this.config.timeoutMs
      }
    );

    if (response.data?.success === false) {
      const error = new Error(
        String(
          response.data.error ||
          'WhatsApp group request rejected'
        ).split('\n')[0]
      );

      error.definitelyNotSent = true;

      throw error;
    }

    if (response.data?.success !== true) {
      throw new Error(
        'Uncertain WhatsApp group response; verify before retrying'
      );
    }

    return response.data;
  }
}

module.exports = DepositVAGroupChannel;
const axios = require('axios');
const Channel = require('./Channel');

class WhatsAppGroupChannel extends Channel {
  constructor(config) {
    super('WHATSAPP_GROUP');
    this.config = config;
  }

  accepts(recipient) {
    return recipient.role === 'FINACC';
  }

  async send({ type, recipient, text }) {
    if (!['PAYMENT', 'RECEIPTREQ'].includes(type) || recipient.role !== 'FINACC') {
      const error = new Error('Unsupported Finance group notification');
      error.statusCode = 400;
      error.retryable = false;
      throw error;
    }
    const { baseUrl, timeoutMs } = this.config;
    if (!baseUrl) throw new Error('WhatsApp base URL is not configured');
    const response = await axios.post(
      `${baseUrl}/BT/api/whatsapp/send-text-to-group`,
      {
        sessionId: this.config.groupSessionId || 'it',
        groupName: this.config.AccgroupName || 'Cbl Finance & IT',
        message: text
      },
      { timeout: timeoutMs }
    );
    if (response.data?.success === false) {
      const error = new Error(String(response.data.error || 'WhatsApp group send failed').split('\n')[0]);
      error.definitelyNotSent = true;
      throw error;
    }
    return response.data;
  }
}

module.exports = WhatsAppGroupChannel;

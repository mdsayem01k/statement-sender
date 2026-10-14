const axios = require('axios');
const Channel = require('./Channel');
const { toIntl } = require('../utils/phone');

class WhatsAppChannel extends Channel {
  constructor(config) {
    super('WHATSAPP');
    this.config = config;
  }

  accepts(recipient) {
    return !!toIntl(recipient.mobile);
  }

  async send({ recipient, text }) {
    const { baseUrl, sessionId, timeoutMs } = this.config;
    const response = await axios.post(
      `${baseUrl}/BT/api/whatsapp/send-text`,
      {
        sessionId,
        recipientJid: toIntl(recipient.mobile),
        message: text,
        investor: recipient.name
      },
      { timeout: timeoutMs }
    );
    if (response.data?.success === false) {
      throw new Error(String(response.data.error || 'WhatsApp send failed').split('\n')[0]);
    }
    return response.data;
  }
}

module.exports = WhatsAppChannel;

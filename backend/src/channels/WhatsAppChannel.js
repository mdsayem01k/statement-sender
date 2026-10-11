const axios = require('axios');
const Channel = require('./Channel');
const { toIntl } = require('../utils/phone');

class WhatsAppChannel extends Channel {
  constructor(config) {
    super('WHATSAPP');
    this.config = config; // env.whatsapp
  }

  accepts(recipient) {
    return !!toIntl(recipient.mobile);
  }

  async send({ recipient, text, isAcc }) {
  const { baseUrl, sessionId, timeoutMs } = this.config;
  const response = await axios.post(
    `${baseUrl}/BT/api/whatsapp/send-text`,
    { sessionId, recipientJid: toIntl(recipient.mobile), message: text, investor: recipient.name },
    { timeout: timeoutMs }
  );
  if (response.data?.success === false) {
    throw new Error(String(response.data.error || 'WhatsApp send failed').split('\n')[0]);
  }

  // copy to the group: investor message only (not the RM's), and never fail the main send
  if (isAcc && recipient.role !== 'RM') {
    try {
      await axios.post(
        `${baseUrl}/BT/api/whatsapp/send-text-to-group`,
        { sessionId: this.config.groupSessionId || 'it', groupName: this.config.groupName || 'Demo Group', message: text },
        { timeout: timeoutMs }
      );
    } catch (err) {
      console.error('[WHATSAPP] group send failed:', err.message);
    }
  }
  return response.data;
}
}

module.exports = WhatsAppChannel;

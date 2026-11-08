const axios = require('axios');
const { toIntl } = require('../../utils/phone');

function rejection(message, statusCode = 400) {
  const error = new Error(message);
  error.definitelyNotSent = true;
  error.statusCode = statusCode;
  return error;
}

class Sender {
  constructor(shared, settings) {
    this.shared = shared;
    this.settings = settings;
  }

  async send(message) {
    const s = this.settings;
    const recipient = { ...message.recipient };
    recipient.mobile = String(s.testMobile || this.shared.testMobile || recipient.mobile || '').split(',')[0].trim();
    recipient.email = String(s.testEmail || this.shared.testEmail || recipient.email || '').split(',')[0].trim();
    const order = message.via === 'EMAIL' ? ['EMAIL'] :
      message.whatsappOnly ? ['WHATSAPP'] :
      s.mobileFirst === 'SMS' ? ['SMS', 'WHATSAPP'] : ['WHATSAPP', 'SMS'];
    const channels = order.filter(name => {
      if (name === 'EMAIL') return s.emailEnabled;
      if (message.whatsappOnly) return true;
      return name === 'SMS' ? s.smsEnabled : s.whatsappEnabled;
    });
    if (!channels.length) throw rejection('Delivery channel is disabled');
    const errors = [];
    for (let index = 0; index < channels.length; index++) {
      const name = channels[index];
      const chain = name === 'EMAIL' ? 'EMAIL' : 'MOBILE';
      const channel = this.shared.chains[chain]?.find(entry => entry.channel.name === name)?.channel;
      let result;
      try {
        if (!channel) throw rejection(`${name} channel is not configured`);
        if (!channel.accepts(recipient)) throw rejection(`Invalid ${name} recipient`);
        if (name === 'WHATSAPP') {
          const c = channel.config;
          if (!c.baseUrl || !c.sessionId) throw rejection('WhatsApp URL/session is missing');
          let response;
          try {
            response = await axios.post(`${c.baseUrl.replace(/\/+$/, '')}/BT/api/whatsapp/send-text`, {
              sessionId: c.sessionId, recipientJid: toIntl(recipient.mobile),
              message: message.text, investor: recipient.name
            }, { timeout: c.timeoutMs });
          } catch (error) {
            if (error.response?.data?.success === false) throw rejection(String(error.response.data.error || 'WhatsApp rejected'), error.response.status);
            throw error;
          }
          result = response.data;
          if (result?.success === false) throw rejection(String(result.error || 'WhatsApp rejected'), 502);
          if (result?.success !== true) throw new Error('Uncertain WhatsApp response');
        } else {
          result = await channel.send({ ...message, recipient, isAcc: 0 });
          if (result?.success === false) throw rejection(String(result.error || `${name} rejected`), 502);
        }
      } catch (error) {
        if (error.errorType === 'SMS_DAILY_LIMIT') error.definitelyNotSent = true;
        errors.push(`${name}: ${error.message}`);
        if (error.definitelyNotSent && index < channels.length - 1) continue;
        error.fallbackErrors = errors;
        throw error;
      }
      return { channel: name, via: message.via, attempts: 1, fallbackErrors: errors, messageText: message.text, data: result };
    }
  }
}

module.exports = { Sender, rejection };

const axios = require('axios');
const Channel = require('./Channel');
const { toIntl, toLocal } = require('../utils/phone');

class SmsChannel extends Channel {
  constructor(config) {
    super('SMS');
    this.config = config; // env.sms
  }

  accepts(recipient) {
    return !!toIntl(recipient.mobile);
  }

  async send({ recipient, text }) {
    const { baseUrl, timeoutMs } = this.config;
    if (!baseUrl) throw new Error('SMS_BASE_URL is not configured');

    const { data } = await axios.post(
      `${baseUrl}/api/sms/single`,
      { to: toLocal(toIntl(recipient.mobile)), message: text }, // 01XXXXXXXXX
      { timeout: timeoutMs }
    );
    if (!data?.success || data.summary?.failed > 0) {
      throw new Error(data?.ack?.error_message || data?.ack?.smsinfo?.[0]?.status_message || 'SMS send failed');
    }
    return data;
  }
}

module.exports = SmsChannel;

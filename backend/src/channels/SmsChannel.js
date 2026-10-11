const axios = require('axios');
const Channel = require('./Channel');
const { toIntl, toLocal } = require('../utils/phone');
const SmsLimitService = require('../services/SmsLimitService');

class SmsChannel extends Channel {
  constructor(config) {
    super('SMS');

    this.config = config;
    this.limitService = new SmsLimitService();
  }

  accepts(recipient) {
    return !!toIntl(recipient.mobile);
  }

  async send({ recipient, text }) {
    const { baseUrl, timeoutMs } = this.config;

    if (!baseUrl) {
      throw new Error('SMS_BASE_URL is not configured');
    }

    const mobile = toIntl(recipient.mobile);

    if (!mobile) {
      const error = new Error('Invalid SMS mobile number');

      error.statusCode = 400;
      error.retryable = false;

      throw error;
    }

    await this.limitService.reserve(mobile);

    const { data } = await axios.post(
      `${baseUrl}/api/sms/single`,
      {
        to: toLocal(mobile),
        message: text
      },
      {
        timeout: timeoutMs
      }
    );

    if (!data?.success || data.summary?.failed > 0) {
      throw new Error(
        data?.ack?.error_message ||
        data?.ack?.smsinfo?.[0]?.status_message ||
        'SMS send failed'
      );
    }

    return data;
  }
}

module.exports = SmsChannel;
const axios = require('axios');
const Channel = require('./Channel');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class EmailChannel extends Channel {
  constructor(config) {
    super('EMAIL');
    this.config = config; // env.mail
  }

  accepts(recipient) {
    return EMAIL_REGEX.test(String(recipient.email || ''));
  }

  async send({ recipient, text, subject, html }) {
    const { baseUrl, apiKey, timeoutMs } = this.config;
    if (!baseUrl) throw this.fail(500, 'Mail service is not configured.', 'INTERNAL');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
      const res = await axios.post(
        `${baseUrl}/api/mail/send`,
        { to: recipient.email, subject, text, html },
        { timeout: timeoutMs, headers }
      );
      return res.data;
    } catch (error) {
      const m = this.mapError(error);
      console.error(`[EMAIL ERROR] [${m.errorType}]:`, error.response?.data ? JSON.stringify(error.response.data) : error.message);
      throw this.fail(m.statusCode, m.message, m.errorType);
    }
  }

  fail(statusCode, message, errorType) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.errorType = errorType;
    return err;
  }

  mapError(error) {
    if (!axios.isAxiosError(error)) return { statusCode: 500, message: 'Failed to process email request.', errorType: 'INTERNAL' };
    if (error.response) {
      const up = error.response.data || {};
      const message = up.message || error.message;
      const errorType = up.errorType || 'MAIL_API_ERROR';
      return error.response.status === 422
        ? { statusCode: 422, message, errorType }
        : { statusCode: 502, message: `Mail service error: ${message}`, errorType };
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return { statusCode: 504, message: 'Mail service timed out.', errorType: 'MAIL_API_TIMEOUT' };
    }
    return { statusCode: 502, message: 'Mail service is unreachable.', errorType: 'MAIL_API_UNREACHABLE' };
  }
}

module.exports = EmailChannel;

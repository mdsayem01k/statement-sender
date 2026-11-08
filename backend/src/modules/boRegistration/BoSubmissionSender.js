const { Sender } = require('../boAccount/Sender');
const { boolean } = require('../boAccount/config');

class BoSubmissionSender {
  constructor(shared) {
    this.shared = shared;
    this.settings = {
      mobileFirst: String(process.env.BO_MOBILE_FIRST || 'WHATSAPP').trim().toUpperCase(),
      whatsappEnabled: boolean(process.env, 'BO_WHATSAPP_ENABLED', true),
      smsEnabled: boolean(process.env, 'BO_SMS_ENABLED', true),
      emailEnabled: boolean(process.env, 'BO_EMAIL_ENABLED', false),
      testMobile: String(process.env.BO_TEST_MOBILE || ''),
      testEmail: String(process.env.BO_TEST_EMAIL || '')
    };
    if (!['SMS', 'WHATSAPP'].includes(this.settings.mobileFirst)) throw new Error('Invalid BO_MOBILE_FIRST');
    this.sender = new Sender(shared, this.settings);
  }

  async send(options) {
    const via = String(options.via || 'MOBILE').toUpperCase();
    const dateTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    }).format(new Date()).replace(/\b(am|pm)\b/g, value => value.toUpperCase());
    const data = { ...options.data, dateTime };
    const message = {
      ...options, via,
      text: this.shared.render(options.type, data, 'text')
    };
    if (via === 'EMAIL') {
      message.subject = this.shared.render(options.type, data, 'subject');
      message.html = this.shared.render(options.type, data, 'html');
    }
    let result;
    try {
      result = await this.sender.send(message);
    } catch (error) {
      await this.audit(options, 'FAILED', error.message);
      throw error;
    }
    await this.audit(options, `${result.channel}_SENT`);
    return result;
  }

  async audit(options, status, errorMessage = null) {
    try {
      await this.shared.audit.save({ ...options.meta, status: `BO_REGISTRATION_${status}`,
        statusCode: errorMessage ? 502 : 200, errorMessage });
    } catch (error) { console.error('[BO SUBMISSION AUDIT]', error.message); }
  }
}

module.exports = BoSubmissionSender;

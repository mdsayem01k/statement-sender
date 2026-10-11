// THE one place that sends messages.
//   - builds text / email from config/messageTemplates.json
//   - walks a chain of channels: WhatsApp (1 try) -> SMS (max 3 tries); Email (1 try)
//   - writes the audit log
// Modules never talk to a channel directly; they call messageCenter.send({ type, via, ... }).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

class MessageCenter {
  // chains: { MOBILE: [{ channel, attempts }], EMAIL: [{ channel, attempts }] }
  constructor({ templates, chains, audit, testMobile = '', testEmail = '', retryDelayMs = 1000 }) {
    this.templates = templates;
    this.chains = chains;
    this.audit = audit;
    this.testMobile = testMobile;
    this.testEmail = testEmail;
    this.retryDelayMs = retryDelayMs;
  }

  // part: 'text' | 'subject' | 'html'  (html values are escaped)
  render(type, data = {}, part = 'text') {
    const tpl = this.templates[type];
    if (!tpl) throw new Error(`Unknown message type: ${type}`);
    const source = part === 'text' ? tpl.text : tpl.email?.[part];
    if (source == null) throw new Error(`Message ${type} has no "${part}" template`);

    const missing = [];
    const out = source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      if (data[key] == null) { missing.push(key); return ''; }
      return part === 'html' ? escapeHtml(data[key]) : String(data[key]);
    });
    if (missing.length) throw new Error(`Message ${type}: missing value(s) for ${missing.join(', ')}`);
    return out;
  }

  // send({ type, via: 'MOBILE' | 'EMAIL', recipient: { mobile, email, name }, data, meta })
  //   meta (for the audit log): { encryptoCode, resolvedCode, clientIp, userAgent }
  // Returns { via, channel, attempts, fallbackErrors, messageText, data }
  // Throws one error (with .messageText) when every channel failed.
  async send({ type, isAcc=1,via = 'MOBILE', recipient = {}, data = {}, meta = {} }) {
    let messageText = '';
    const failedStatus = via === 'EMAIL' ? `${type}_EMAIL_FAILED` : `${type}_FAILED`;
    const log = (status, statusCode, errorMessage) =>
      this.audit.save({ ...meta, status, statusCode, errorMessage: errorMessage || null });

    try {
      const chain = this.chains[via];
      if (!chain) throw new Error(`Unknown delivery type: ${via}`);

      const to = { ...recipient };
      if (via === 'MOBILE' && this.testMobile) to.mobile = this.testMobile;
      if (via === 'EMAIL' && this.testEmail) to.email = this.testEmail;

      // isAcc for send sms to fin team

      const payload = { type, recipient: to, text: this.render(type, data, 'text'),isAcc };
      if (via === 'EMAIL') {
        payload.subject = this.render(type, data, 'subject');
        payload.html = this.render(type, data, 'html');
      }
      messageText = payload.text;

      const usable = chain.filter((s) => s.channel.accepts(to));
      if (!usable.length) {
        throw new Error(via === 'EMAIL' ? `Invalid email address: ${to.email}` : `Invalid mobile number: ${to.mobile}`);
      }

      const errors = [];
      let lastErr;
      for (const { channel, attempts = 1 } of usable) {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const res = await channel.send(payload);
            await log(`${type}_${channel.name}_SENT`, 200, errors.length ? errors.join(' | ') : null);
            return { via, channel: channel.name, attempts: attempt, fallbackErrors: errors, messageText, data: res };
          } catch (err) {
            lastErr = err;
            console.warn(`[MESSAGE ${type}] ${channel.name} attempt ${attempt}/${attempts} failed:`, err.message);
            if (attempt < attempts) await sleep(this.retryDelayMs);
          }
        }
        errors.push(`${channel.name}: ${lastErr.message}`);
      }

      const failure = new Error(errors.join(' | '));
      if (usable.length === 1) { failure.statusCode = lastErr.statusCode; failure.errorType = lastErr.errorType; }
      throw failure;
    } catch (err) {
      await log(failedStatus, err.statusCode || 500, err.message);
      err.messageText = messageText;
      throw err;
    }
  }
}

module.exports = MessageCenter;

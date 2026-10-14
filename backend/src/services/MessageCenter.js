const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

class MessageCenter {
  constructor({
    templates,
    chains,
    audit,
    testMobile = '',
    testEmail = '',
    retryDelayMs = 1000
  }) {
    this.templates = templates;
    this.chains = chains;
    this.audit = audit;
    this.testMobile = testMobile;
    this.testEmail = testEmail;
    this.retryDelayMs = retryDelayMs;
  }

  render(type, data = {}, part = 'text') {
    const template = this.templates[type];

    if (!template) {
      throw new Error(`Unknown message type: ${type}`);
    }

    const source =
      part === 'text' || part === 'textRM'
        ? template[part]
        : template.email?.[part];

    if (source == null) {
      throw new Error(
        `Message ${type} has no "${part}" template`
      );
    }

    const missing = [];

    const output = source.replace(
      /\{\{\s*(\w+)\s*\}\}/g,
      (_, key) => {
        if (data[key] == null) {
          missing.push(key);
          return '';
        }

        return part === 'html'
          ? escapeHtml(data[key])
          : String(data[key]);
      }
    );

    if (missing.length) {
      throw new Error(
        `Message ${type}: missing value(s) for ${missing.join(', ')}`
      );
    }

    return output;
  }

  async send({
    type,
    isAcc = 1,
    via = 'MOBILE',
    recipient = {},
    data = {},
    meta = {}
  }) {
    let messageText = '';

    const failedStatus =
      via === 'EMAIL'
        ? `${type}_EMAIL_FAILED`
        : `${type}_FAILED`;

    const log = (status, statusCode, errorMessage) =>
      this.audit.save({
        ...meta,
        status,
        statusCode,
        errorMessage: errorMessage || null
      });

    try {
      const configuredChain = this.chains[via];

      if (!Array.isArray(configuredChain)) {
        throw new Error(`Unknown delivery type: ${via}`);
      }

      // const chain = this.chains[via];
      const chain =
        type === 'TRADE_CONFIRMATION' && via === 'MOBILE'
          ? configuredChain.filter(
              entry => entry.channel.name === 'SMS'
            )
          : configuredChain;

      if (!chain.length) {
        throw new Error(
          `No delivery channel configured for ${type}/${via}`
        );
      }

      const to = { ...recipient };

      if (via === 'MOBILE' && this.testMobile) {
        to.mobile = this.testMobile;
      }

      if (via === 'EMAIL' && this.testEmail) {
        to.email = this.testEmail;
      }

      const internalRecipient = via !== 'EMAIL' && ['RM', 'FINACC'].includes(to.role);
      const textPart = internalRecipient && this.templates[type]?.textRM != null ? 'textRM' : 'text';

      const payload = {
        type,
        recipient: to,
        text: this.render(type, data, textPart),
        isAcc
      };

      if (via === 'EMAIL') {
        payload.subject = this.render(type, data, 'subject');
        payload.html = this.render(type, data, 'html');
      }

      messageText = payload.text;

      const usable = chain.filter(
        entry => entry.channel.accepts(to)
      );

      if (!usable.length) {
        const error = new Error(
          via === 'EMAIL'
            ? `Invalid email address: ${to.email}`
            : `Invalid mobile number: ${to.mobile}`
        );

        error.statusCode = 400;
        error.retryable = false;

        throw error;
      }

      const errors = [];
      let lastErr;

      for (const { channel, attempts = 1 } of usable) {
        const maxAttempts = Math.max(
          1,
          Math.floor(Number(attempts)) || 1
        );

        for (
          let attempt = 1;
          attempt <= maxAttempts;
          attempt++
        ) {
          try {
            const result = await channel.send(payload);

            await log(
              `${type}_${channel.name}_SENT`,
              200,
              errors.length ? errors.join(' | ') : null
            );

            return {
              via,
              channel: channel.name,
              attempts: attempt,
              fallbackErrors: errors,
              messageText,
              data: result
            };
          } catch (error) {
            lastErr = error;

            console.warn(
              `[MESSAGE ${type}] ${channel.name} attempt ${attempt}/${maxAttempts} failed:`,
              error.message
            );

            if (error.retryable === false) {
              break;
            }

            if (attempt < maxAttempts) {
              await sleep(this.retryDelayMs);
            }
          }
        }

        errors.push(
          `${channel.name}: ${lastErr?.message || 'Delivery failed'}`
        );
      }

      const failure = new Error(errors.join(' | '));

      failure.statusCode = lastErr?.statusCode || 500;
      failure.errorType = lastErr?.errorType;
      failure.retryable = lastErr?.retryable;
      failure.definitelyNotSent = usable.length === 1 && lastErr?.definitelyNotSent === true;
      failure.fallbackErrors = errors;

      throw failure;
    } catch (error) {
      await log(
        failedStatus,
        error.statusCode || 500,
        error.message
      );

      error.messageText = messageText;

      throw error;
    }
  }
}

module.exports = MessageCenter;
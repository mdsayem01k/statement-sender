const axios = require('axios');
const MessageCenter = require('../../services/MessageCenter');
const { toIntl } = require('../../utils/phone');

function enabled(name, fallback) {
  const value = String(
    process.env[name] ?? fallback
  ).trim().toLowerCase();

  if (!['true', 'false'].includes(value)) {
    throw new Error(`${name} must be true or false`);
  }

  return value === 'true';
}

function rejected(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.definitelyNotSent = true;
  return error;
}

class BoMessageCenter extends MessageCenter {
  constructor(shared) {
    super({
      templates: shared.templates,
      chains: shared.chains,
      audit: shared.audit,
      testMobile: shared.testMobile,
      testEmail: shared.testEmail,
      retryDelayMs: shared.retryDelayMs
    });

    this.emailEnabled = enabled('BO_EMAIL_ENABLED', false);

    const first = String(
      process.env.BO_MOBILE_FIRST || 'WHATSAPP'
    ).trim().toUpperCase();

    if (!['WHATSAPP', 'SMS'].includes(first)) {
      throw new Error(
        'BO_MOBILE_FIRST must be WHATSAPP or SMS'
      );
    }

    const switches = {
      WHATSAPP: enabled('BO_WHATSAPP_ENABLED', true),
      SMS: enabled('BO_SMS_ENABLED', true)
    };

    const order = first === 'SMS'
      ? ['SMS', 'WHATSAPP']
      : ['WHATSAPP', 'SMS'];

    this.mobileChannels = order
      .filter(name => switches[name])
      .map(name => {
        const entry = (shared.chains.MOBILE || [])
          .find(item => item.channel.name === name);

        if (!entry) {
          throw new Error(
            `BO ${name} channel is not configured`
          );
        }

        return entry.channel;
      });
  }

  async sendWhatsApp(channel, payload) {
    const { baseUrl, sessionId, timeoutMs } = channel.config;

    if (!baseUrl || !sessionId) {
      throw rejected(
        'BO WhatsApp URL or session is missing',
        400
      );
    }

    let response;

    try {
      response = await axios.post(
        `${String(baseUrl).replace(/\/+$/, '')}/BT/api/whatsapp/send-text`,
        {
          sessionId,
          recipientJid: toIntl(payload.recipient.mobile),
          message: payload.text,
          investor: payload.recipient.name
        },
        { timeout: timeoutMs }
      );
    } catch (error) {
      if (error.response?.data?.success === false) {
        throw rejected(
          String(
            error.response.data.error ||
            'WhatsApp request rejected'
          ),
          error.response.status
        );
      }

      throw error;
    }

    if (response.data?.success === false) {
      throw rejected(
        String(
          response.data.error ||
          'WhatsApp request rejected'
        )
      );
    }

    if (response.data?.success !== true) {
      throw new Error(
        'Uncertain WhatsApp response; verify before retrying'
      );
    }

    return response.data;
  }

  async saveAudit(options, status, statusCode, errorMessage) {
    try {
      await this.audit.save({
        ...options.meta,
        recipientRole: options.recipient?.role || 'INVESTOR',
        status,
        statusCode,
        errorMessage: errorMessage || null
      });
    } catch (error) {
      console.error('[BO AUDIT]', error.message);
    }
  }

  async send(options) {
    if (options.type !== 'BO_REGISTRATION') {
      throw rejected('Unsupported BO message type', 400);
    }

    const via = String(
      options.via || 'MOBILE'
    ).toUpperCase();

    if (via === 'EMAIL') {
      if (!this.emailEnabled) {
        throw rejected('BO email is disabled', 400);
      }

      return super.send({ ...options, via });
    }

    if (via !== 'MOBILE') {
      throw rejected('Unsupported BO delivery route', 400);
    }

    const recipient = {
      ...options.recipient,
      mobile: String(
        this.testMobile ||
        options.recipient?.mobile ||
        ''
      ).split(',')[0].trim()
    };

    const payload = {
      type: options.type,
      recipient,
      text: this.render(options.type, options.data, 'text'),
      isAcc: 0
    };

    const errors = [];

    for (let index = 0; index < this.mobileChannels.length; index++) {
      const channel = this.mobileChannels[index];
      let result;

      try {
        if (!channel.accepts(recipient)) {
          throw rejected(
            `Invalid mobile number: ${recipient.mobile}`,
            400
          );
        }

        result = channel.name === 'WHATSAPP'
          ? await this.sendWhatsApp(channel, payload)
          : await channel.send(payload);
      } catch (error) {
        errors.push(`${channel.name}: ${error.message}`);

        const canFallback =
          error.definitelyNotSent === true &&
          index < this.mobileChannels.length - 1;

        if (canFallback) {
          continue;
        }

        error.messageText = payload.text;
        error.fallbackErrors = errors;

        await this.saveAudit(
          options,
          'BO_REGISTRATION_FAILED',
          error.statusCode || 500,
          errors.join(' | ')
        );

        throw error;
      }

      await this.saveAudit(
        options,
        `BO_REGISTRATION_${channel.name}_SENT`,
        200,
        errors.length ? errors.join(' | ') : null
      );

      return {
        via,
        channel: channel.name,
        attempts: 1,
        fallbackErrors: errors,
        messageText: payload.text,
        data: result
      };
    }

    throw rejected(
      'BO mobile notifications are disabled',
      400
    );
  }
}

module.exports = BoMessageCenter;
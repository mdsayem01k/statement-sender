const axios = require('axios');
const MessageCenter = require('../../services/MessageCenter');
const { toIntl } = require('../../utils/phone');

class CityAgentMessageCenter extends MessageCenter {
  constructor(shared, settings) {
    const mobileChannels = new Map();

    if (settings.whatsappEnabled) {
      const configured = shared.chains.MOBILE.find(
        entry => entry.channel.name === 'WHATSAPP'
      );

      if (!configured) {
        throw new Error(
          'CityAgent WhatsApp channel is not configured'
        );
      }

      const original = configured.channel;

      mobileChannels.set('WHATSAPP', {
        name: 'WHATSAPP',

        accepts: recipient => original.accepts(recipient),

        async send({ recipient, text }) {
          const {
            baseUrl,
            sessionId,
            timeoutMs
          } = original.config;

          const response = await axios.post(
            `${baseUrl}/BT/api/whatsapp/send-text`,
            {
              sessionId,
              recipientJid: toIntl(recipient.mobile),
              message: text,
              investor: recipient.name
            },
            {
              timeout: timeoutMs
            }
          );

          if (response.data?.success === false) {
            const error = new Error(
              String(
                response.data.error ||
                'WhatsApp request rejected'
              ).split('\n')[0]
            );

            error.definitelyNotSent = true;

            throw error;
          }

          if (response.data?.success !== true) {
            throw new Error(
              'Uncertain WhatsApp response; verify before retrying'
            );
          }

          return response.data;
        }
      });
    }

    if (settings.smsEnabled) {
      const configured = shared.chains.MOBILE.find(
        entry => entry.channel.name === 'SMS'
      );

      if (!configured) {
        throw new Error(
          'CityAgent SMS channel is not configured'
        );
      }

      const original = configured.channel;

      mobileChannels.set('SMS', {
        name: 'SMS',

        accepts: recipient => original.accepts(recipient),

        async send(payload) {
          try {
            return await original.send(payload);
          } catch (error) {
            if (error.errorType === 'SMS_DAILY_LIMIT') {
              error.definitelyNotSent = true;
            }

            throw error;
          }
        }
      });
    }

    const order =
      settings.mobileFirst === 'SMS'
        ? ['SMS', 'WHATSAPP']
        : ['WHATSAPP', 'SMS'];

    const mobile = order
      .filter(name => mobileChannels.has(name))
      .map(name => ({
        channel: mobileChannels.get(name),
        attempts: 1
      }));

    const email = settings.emailEnabled
      ? (shared.chains.EMAIL || []).map(entry => ({
          ...entry,
          attempts: 1
        }))
      : [];

    if (settings.emailEnabled && !email.length) {
      throw new Error(
        'CityAgent email channel is not configured'
      );
    }

    super({
      templates: shared.templates,
      chains: {
        MOBILE: mobile,
        EMAIL: email
      },
      audit: shared.audit,
      testMobile: shared.testMobile,
      testEmail: shared.testEmail,
      retryDelayMs: shared.retryDelayMs
    });
  }

  async send(options) {
    const via = options.via || 'MOBILE';

    if (via !== 'MOBILE') {
      return super.send(options);
    }

    const chain = this.chains.MOBILE;

    if (!chain.length) {
      const error = new Error(
        'CityAgent mobile notifications are disabled'
      );

      error.definitelyNotSent = true;

      throw error;
    }

    const fallbackErrors = [];

    for (let index = 0; index < chain.length; index++) {
      const entry = chain[index];

      const center = new MessageCenter({
        templates: this.templates,
        chains: {
          MOBILE: [entry]
        },
        audit: this.audit,
        testMobile: this.testMobile,
        testEmail: this.testEmail,
        retryDelayMs: this.retryDelayMs
      });

      try {
        const result = await center.send({
          ...options,
          via: 'MOBILE'
        });

        return {
          ...result,
          fallbackErrors: [
            ...fallbackErrors,
            ...(result.fallbackErrors || [])
          ]
        };
      } catch (error) {
        fallbackErrors.push(
          `${entry.channel.name}: ${error.message}`
        );

        const canFallback =
          error.definitelyNotSent === true &&
          error.errorType !== 'MESSAGE_TEMPLATE_VALIDATION' &&
          index < chain.length - 1;

        if (!canFallback) {
          error.fallbackErrors = fallbackErrors;

          throw error;
        }
      }
    }
  }
}

module.exports = CityAgentMessageCenter;
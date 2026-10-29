const axios = require('axios');
const MessageCenter = require('../../services/MessageCenter');
const { toIntl } = require('../../utils/phone');
const DepositReqGroupChannel = require('./DepositReqGroupChannel');
const whatsappRequest = require('./whatsappRequest');

class DepositReqMessageCenter extends MessageCenter {
  constructor(shared, settings) {
    const mobileChannels = new Map();

    if (settings.whatsappEnabled) {
      const configured = (shared.chains.MOBILE || []).find(
        entry => entry.channel.name === 'WHATSAPP'
      );

      if (!configured) {
        throw new Error(
          'DepositReq WhatsApp channel is not configured'
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

          const root = String(baseUrl || '').trim().replace(/\/+$/, '');
          if (!root || !String(sessionId || '').trim()) {
            const error = new Error('WhatsApp URL or session is missing');
            error.definitelyNotSent = true;
            throw error;
          }
          return whatsappRequest(
            axios,
            `${root}/BT/api/whatsapp/send-text`,
            {
              sessionId: String(sessionId).trim(),
              recipientJid: toIntl(recipient.mobile),
              message: text,
              investor: recipient.name
            },
            { timeout: timeoutMs }
          );
        }
      });
    }

    if (settings.smsEnabled) {
      const configured = (shared.chains.MOBILE || []).find(
        entry => entry.channel.name === 'SMS'
      );

      if (!configured) {
        throw new Error(
          'DepositReq SMS channel is not configured'
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

    const order = settings.mobileFirst === 'SMS'
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
        'DepositReq email channel is not configured'
      );
    }

    const groupEnabled =
      settings.rmGroupEnabled || settings.groupEnabled || settings.csdGroupEnabled;

    const configuredGroup = (
      shared.chains.GROUP || []
    ).find(
      entry => entry.channel.name === 'WHATSAPP_GROUP'
    );

    if (
      groupEnabled &&
      !configuredGroup?.channel.config
    ) {
      throw new Error(
        'DepositReq group channel is not configured'
      );
    }

    const group = groupEnabled
      ? [{
          channel: new DepositReqGroupChannel(
            configuredGroup.channel.config,
            settings
          ),
          attempts: 1
        }]
      : [];

    super({
      templates: shared.templates,
      chains: {
        MOBILE: mobile,
        EMAIL: email,
        GROUP: group
      },
      audit: shared.audit,
      testMobile: shared.testMobile,
      testEmail: shared.testEmail,
      retryDelayMs: shared.retryDelayMs
    });
    this.messageType = settings.messageType || 'RECEIPTREQ';
  }

  async send(options) {
    const via = String(options.via || 'MOBILE').toUpperCase();
    const recipient = { ...options.recipient };
    recipient.role = String(recipient.role || 'INVESTOR').toUpperCase();
    recipient.mobile = String(recipient.mobile || '').split(',')[0].trim();
    recipient.email = String(recipient.email || '').split(',')[0].trim();
    const reject = async error => {
      try {
        await this.audit.save({
          ...options.meta,
          recipientRole: recipient.role,
          status: via === 'EMAIL' ? `${options.type}_EMAIL_FAILED` : `${options.type}_FAILED`,
          statusCode: error.statusCode || 400,
          errorMessage: error.message
        });
      } catch (auditError) {
        console.error(`[${options.type} AUDIT]`, auditError.message);
      }
      throw error;
    };
    const groupRoles = ['RM_GROUP', 'FINACC', 'DEMO_GROUP', 'CSD'];
    const correctRoute = recipient.role === 'INVESTOR'
      ? ['MOBILE', 'EMAIL'].includes(via)
      : groupRoles.includes(recipient.role) && via === 'GROUP';
    if (options.type !== this.messageType || !correctRoute) {
      const error = new Error(`Unsupported ${options.type} recipient route: ${recipient.role}/${via}`);
      error.statusCode = 400;
      error.errorType = 'INVALID_RECIPIENT_ROUTE';
      error.definitelyNotSent = true;
      return reject(error);
    }
    options = { ...options, via, recipient };
    try {
      const part = via === 'GROUP' && this.templates[options.type]?.textRM != null
        ? 'textRM' : 'text';
      this.render(options.type, options.data, part);
      if (via === 'EMAIL') {
        this.render(options.type, options.data, 'subject');
        this.render(options.type, options.data, 'html');
      }
    } catch (error) {
      error.statusCode = 400;
      error.errorType = 'MESSAGE_TEMPLATE_VALIDATION';
      error.definitelyNotSent = true;
      return reject(error);
    }

    if (
      via === 'GROUP' &&
      ['RM_GROUP', 'FINACC', 'DEMO_GROUP', 'CSD'].includes(options.recipient?.role)
    ) {
      const template = this.templates[options.type];

      const greeting = options.type === 'DEPOSIT_APPROVE'
        ? {
            CSD: 'Dear CSD Team,',
            FINACC: 'Dear FINANCE Team,'
          }[recipient.role]
        : null;

      const groupText = template?.textRM ?? template?.text;

      const renderedGroupTemplate =
        greeting && typeof groupText === 'string'
          ? groupText.replace(/^Dear RM,/i, greeting)
          : groupText;

      const templates = {
        ...this.templates,
        [options.type]: {
          ...template,
          text: renderedGroupTemplate,
          textRM: renderedGroupTemplate
        }
      };

      const center = new MessageCenter({
        templates,
        chains: {
          GROUP: this.chains.GROUP
        },
        audit: this.audit,
        retryDelayMs: this.retryDelayMs
      });

      return center.send(options);
    }

    if (via !== 'MOBILE') {
      return super.send(options);
    }

    const chain = this.chains.MOBILE;

    if (!chain.length) {
      const error = new Error(
        'DepositReq mobile notifications are disabled'
      );

      error.definitelyNotSent = true;

      throw error;
    }

    const fallbackErrors = [];

    for (
      let index = 0;
      index < chain.length;
      index++
    ) {
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
        const to = this.testMobile ? { ...recipient, mobile: this.testMobile } : recipient;
        if (!entry.channel.accepts(to)) {
          const error = new Error(`${entry.channel.name} does not accept the mobile number`);
          error.statusCode = 400;
          error.definitelyNotSent = true;
          throw error;
        }
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

module.exports = DepositReqMessageCenter;

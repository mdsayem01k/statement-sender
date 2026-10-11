// Builds the shared services once. Modules receive this as "ctx".
const env = require('../config/env');
const templates = require('../config/messageTemplates.json');
const AuditService = require('../services/AuditService');
const MessageCenter = require('../services/MessageCenter');
const WhatsAppChannel = require('../channels/WhatsAppChannel');
const SmsChannel = require('../channels/SmsChannel');
const EmailChannel = require('../channels/EmailChannel');

function createContext() {
  const audit = new AuditService();

  const messageCenter = new MessageCenter({
    templates,
    audit,
    testMobile: env.notify.testMobile,
    testEmail: env.notify.testEmail,
    retryDelayMs: env.notify.retryDelayMs,
    chains: {
      // WhatsApp once, then SMS up to 3 times
      MOBILE: [
        { channel: new WhatsAppChannel(env.whatsapp), attempts: 1 },
        { channel: new SmsChannel(env.sms), attempts: env.notify.smsMaxAttempts },
      ],
      EMAIL: [{ channel: new EmailChannel(env.mail), attempts: 1 }],
    },
  });

  return { env, audit, messageCenter };
}

module.exports = createContext;

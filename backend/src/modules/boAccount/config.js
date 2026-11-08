const path = require('path');

function boolean(env, key, fallback) {
  const value = String(env[key] ?? fallback).trim().toLowerCase();
  if (!['true', 'false'].includes(value)) throw new Error(`${key} must be true or false`);
  return value === 'true';
}

function config(env = process.env) {
  const since = String(env.BO_ACCOUNT_NOTIFY_SINCE || '').trim();
  const date = new Date(`${since}Z`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(since) ||
      Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== since) {
    throw new Error('BO_ACCOUNT_NOTIFY_SINCE must be YYYY-MM-DDTHH:mm:ss');
  }
  const mobileFirst = String(env.BO_ACCOUNT_MOBILE_FIRST || 'WHATSAPP').trim().toUpperCase();
  if (!['WHATSAPP', 'SMS'].includes(mobileFirst)) throw new Error('Invalid BO_ACCOUNT_MOBILE_FIRST');
  return {
    since, mobileFirst,
    whatsappEnabled: boolean(env, 'BO_ACCOUNT_WHATSAPP_ENABLED', true),
    smsEnabled: boolean(env, 'BO_ACCOUNT_SMS_ENABLED', true),
    emailEnabled: boolean(env, 'BO_ACCOUNT_EMAIL_ENABLED', true),
    rmEnabled: boolean(env, 'BO_ACCOUNT_RM_ENABLED', true),
    agentEnabled: boolean(env, 'BO_ACCOUNT_AGENT_ENABLED', true),
    bankEnabled: boolean(env, 'BO_ACCOUNT_BANK_ENABLED', true),
    pdfDir: path.resolve(__dirname, '../../../', env.BO_ACK_PDF_DIR || 'storage/pdf/bo'),
    bankRef: String(env.BO_ACCOUNT_BANK_REFCODE || 'city').trim(),
    testMobile: String(env.BO_ACCOUNT_TEST_MOBILE || '').trim(),
    testEmail: String(env.BO_ACCOUNT_TEST_EMAIL || '').trim()
  };
}

module.exports = { config, boolean };

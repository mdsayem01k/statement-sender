function identifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid CityAgent SQL identifier: ${value}`);
  }

  return `[${value}]`;
}

function booleanSetting(env, key, defaultValue) {
  const value = String(
    env[key] ?? defaultValue
  ).trim().toLowerCase();

  if (!['true', 'false'].includes(value)) {
    throw new Error(`${key} must be true or false`);
  }

  return value === 'true';
}

function config(env = process.env) {
  const intervalMin = Number(
    env.CITYAGENT_INTERVAL_MIN || 1
  );

  if (
    !Number.isFinite(intervalMin) ||
    intervalMin <= 0 ||
    intervalMin > 1440
  ) {
    throw new Error('Invalid CITYAGENT_INTERVAL_MIN');
  }

  const mobileFirst = String(
    env.CITYAGENT_MOBILE_FIRST || 'WHATSAPP'
  ).trim().toUpperCase();

  if (!['WHATSAPP', 'SMS'].includes(mobileFirst)) {
    throw new Error(
      'CITYAGENT_MOBILE_FIRST must be WHATSAPP or SMS'
    );
  }

  const whatsappEnabled = booleanSetting(
    env,
    'CITYAGENT_WHATSAPP_ENABLED',
    true
  );

  const smsEnabled = booleanSetting(
    env,
    'CITYAGENT_SMS_ENABLED',
    true
  );

  const emailEnabled = booleanSetting(
    env,
    'CITYAGENT_EMAIL_ENABLED',
    true
  );

  return {
    intervalMin,
    mobileFirst,
    whatsappEnabled,
    smsEnabled,
    emailEnabled,
    mobileEnabled: whatsappEnabled || smsEnabled,
    sourceDate: env.CITYAGENT_SOURCE_DATE_COLUMN
      ? identifier(env.CITYAGENT_SOURCE_DATE_COLUMN)
      : null
  };
}

module.exports = { config, identifier };
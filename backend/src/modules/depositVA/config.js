function booleanSetting(env, key, fallback) {
  const value = String(
    env[key] ?? fallback
  ).trim().toLowerCase();

  if (!['true', 'false'].includes(value)) {
    throw new Error(`${key} must be true or false`);
  }

  return value === 'true';
}

function cutoff(value, key) {
  const text = String(value || '').trim();

  const pattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

  if (!pattern.test(text)) {
    throw new Error(
      `${key} must be YYYY-MM-DDTHH:mm:ss`
    );
  }

  const date = new Date(`${text}Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 19) !== text
  ) {
    throw new Error(`Invalid ${key}`);
  }

  return { text, date };
}

function config(env = process.env) {
  const notify = cutoff(
    env.DEPOSITVA_NOTIFY_SINCE,
    'DEPOSITVA_NOTIFY_SINCE'
  );

  const sync = cutoff(
    env.DEPOSITVA_SYNC_SINCE || notify.text,
    'DEPOSITVA_SYNC_SINCE'
  );

  const financeGroup = cutoff(
    env.DEPOSITVA_GROUP_NOTIFY_SINCE || notify.text,
    'DEPOSITVA_GROUP_NOTIFY_SINCE'
  );

  const rmGroup = cutoff(
    env.DEPOSITVA_RM_GROUP_NOTIFY_SINCE || notify.text,
    'DEPOSITVA_RM_GROUP_NOTIFY_SINCE'
  );

  if (sync.date > notify.date) {
    throw new Error(
      'DEPOSITVA_SYNC_SINCE must not be later than DEPOSITVA_NOTIFY_SINCE'
    );
  }

  const mobileFirst = String(
    env.DEPOSITVA_MOBILE_FIRST || 'WHATSAPP'
  ).trim().toUpperCase();

  if (!['WHATSAPP', 'SMS'].includes(mobileFirst)) {
    throw new Error(
      'DEPOSITVA_MOBILE_FIRST must be WHATSAPP or SMS'
    );
  }

  const whatsappEnabled = booleanSetting(
    env,
    'DEPOSITVA_WHATSAPP_ENABLED',
    true
  );

  const smsEnabled = booleanSetting(
    env,
    'DEPOSITVA_SMS_ENABLED',
    false
  );

  const emailEnabled = booleanSetting(
    env,
    'DEPOSITVA_EMAIL_ENABLED',
    false
  );

  const rmGroupEnabled = booleanSetting(
    env,
    'DEPOSITVA_RM_GROUP_ENABLED',
    false
  );

  const groupEnabled = booleanSetting(
    env,
    'DEPOSITVA_GROUP_ENABLED',
    true
  );

  const rmGroupSessionId = String(
    env.DEPOSITVA_RM_GROUP_SESSION_ID || ''
  ).trim();

  return {
    syncSince: sync.text,
    notifySince: notify.date,
    groupSince: financeGroup.date,
    rmGroupSince: rmGroup.date,
    mobileFirst,
    whatsappEnabled,
    smsEnabled,
    mobileEnabled: whatsappEnabled || smsEnabled,
    emailEnabled,
    rmGroupEnabled,
    rmGroupSessionId,
    groupEnabled
  };
}

module.exports = { config };
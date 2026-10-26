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
    env.DEPOSITREQ_NOTIFY_SINCE,
    'DEPOSITREQ_NOTIFY_SINCE'
  );

  const sync = cutoff(
    env.DEPOSITREQ_SYNC_SINCE || notify.text,
    'DEPOSITREQ_SYNC_SINCE'
  );

  const financeGroup = cutoff(
    env.DEPOSITREQ_FINACC_GROUP_NOTIFY_SINCE || notify.text,
    'DEPOSITREQ_FINACC_GROUP_NOTIFY_SINCE'
  );

  const rmGroup = cutoff(
    env.DEPOSITREQ_RM_GROUP_NOTIFY_SINCE || notify.text,
    'DEPOSITREQ_RM_GROUP_NOTIFY_SINCE'
  );

  if (sync.date > notify.date) {
    throw new Error(
      'DEPOSITREQ_SYNC_SINCE must not be later than DEPOSITREQ_NOTIFY_SINCE'
    );
  }

  const mobileFirst = String(
    env.DEPOSITREQ_MOBILE_FIRST || 'WHATSAPP'
  ).trim().toUpperCase();

  if (!['WHATSAPP', 'SMS'].includes(mobileFirst)) {
    throw new Error(
      'DEPOSITREQ_MOBILE_FIRST must be WHATSAPP or SMS'
    );
  }

  const whatsappEnabled = booleanSetting(
    env,
    'DEPOSITREQ_WHATSAPP_ENABLED',
    true
  );

  const smsEnabled = booleanSetting(
    env,
    'DEPOSITREQ_SMS_ENABLED',
    false
  );

  const emailEnabled = booleanSetting(
    env,
    'DEPOSITREQ_EMAIL_ENABLED',
    false
  );

  const rmGroupEnabled = booleanSetting(
    env,
    'DEPOSITREQ_RM_GROUP_ENABLED',
    false
  );

  const groupEnabled = booleanSetting(
    env,
    'DEPOSITREQ_FINACC_GROUP_ENABLED',
    true
  );

  const rmGroupSessionId = String(
    env.DEPOSITREQ_RM_GROUP_SESSION_ID || ''
  ).trim();

  return {
    testGroup: String(env.DEPOSITREQ_TEST_GROUP || '').trim(),
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
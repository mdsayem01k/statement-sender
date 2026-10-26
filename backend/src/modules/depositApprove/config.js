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
    env.DEPOSITAPPROVE_NOTIFY_SINCE,
    'DEPOSITAPPROVE_NOTIFY_SINCE'
  );

  const sync = cutoff(
    env.DEPOSITAPPROVE_SYNC_SINCE || notify.text,
    'DEPOSITAPPROVE_SYNC_SINCE'
  );

  const financeGroup = cutoff(
    env.DEPOSITAPPROVE_FINACC_GROUP_NOTIFY_SINCE || notify.text,
    'DEPOSITAPPROVE_FINACC_GROUP_NOTIFY_SINCE'
  );

  const rmGroup = cutoff(
    env.DEPOSITAPPROVE_RM_GROUP_NOTIFY_SINCE || notify.text,
    'DEPOSITAPPROVE_RM_GROUP_NOTIFY_SINCE'
  );

  if (sync.date > notify.date) {
    throw new Error(
      'DEPOSITAPPROVE_SYNC_SINCE must not be later than DEPOSITAPPROVE_NOTIFY_SINCE'
    );
  }

  const mobileFirst = String(
    env.DEPOSITAPPROVE_MOBILE_FIRST || 'WHATSAPP'
  ).trim().toUpperCase();

  if (!['WHATSAPP', 'SMS'].includes(mobileFirst)) {
    throw new Error(
      'DEPOSITAPPROVE_MOBILE_FIRST must be WHATSAPP or SMS'
    );
  }

  const whatsappEnabled = booleanSetting(
    env,
    'DEPOSITAPPROVE_WHATSAPP_ENABLED',
    true
  );

  const smsEnabled = booleanSetting(
    env,
    'DEPOSITAPPROVE_SMS_ENABLED',
    false
  );

  const emailEnabled = booleanSetting(
    env,
    'DEPOSITAPPROVE_EMAIL_ENABLED',
    false
  );

  const rmGroupEnabled = booleanSetting(
    env,
    'DEPOSITAPPROVE_RM_GROUP_ENABLED',
    false
  );

  const groupEnabled = booleanSetting(
    env,
    'DEPOSITAPPROVE_FINACC_GROUP_ENABLED',
    true
  );

  const rmGroupSessionId = String(
    env.DEPOSITAPPROVE_RM_GROUP_SESSION_ID || ''
  ).trim();

  return {
    messageType: 'DEPOSIT_APPROVE',
    testGroup: String(env.DEPOSITAPPROVE_TEST_GROUP || '').trim(),
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
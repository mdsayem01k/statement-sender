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
    env.PAYMENT_NOTIFY_SINCE,
    'PAYMENT_NOTIFY_SINCE'
  );

  const sync = cutoff(
    env.PAYMENT_SYNC_SINCE || notify.text,
    'PAYMENT_SYNC_SINCE'
  );

  const financeGroup = cutoff(
    env.PAYMENT_FINACC_GROUP_NOTIFY_SINCE || env.FINACC_GROUP_NOTIFY_SINCE || notify.text,
    'PAYMENT_FINACC_GROUP_NOTIFY_SINCE'
  );

  const rmGroup = cutoff(
    env.PAYMENT_RM_GROUP_NOTIFY_SINCE || notify.text,
    'PAYMENT_RM_GROUP_NOTIFY_SINCE'
  );

  if (sync.date > notify.date) {
    throw new Error(
      'PAYMENT_SYNC_SINCE must not be later than PAYMENT_NOTIFY_SINCE'
    );
  }

  const mobileFirst = String(
    env.PAYMENT_MOBILE_FIRST || 'WHATSAPP'
  ).trim().toUpperCase();

  if (!['WHATSAPP', 'SMS'].includes(mobileFirst)) {
    throw new Error(
      'PAYMENT_MOBILE_FIRST must be WHATSAPP or SMS'
    );
  }

  const whatsappEnabled = booleanSetting(
    env,
    'PAYMENT_WHATSAPP_ENABLED',
    true
  );

  const smsEnabled = booleanSetting(
    env,
    'PAYMENT_SMS_ENABLED',
    true
  );

  const emailEnabled = booleanSetting(
    env,
    'PAYMENT_EMAIL_ENABLED',
    false
  );

  const rmGroupEnabled = booleanSetting(
    env,
    'PAYMENT_RM_GROUP_ENABLED',
    false
  );

  const groupEnabled = booleanSetting(
    env,
    'PAYMENT_FINACC_GROUP_ENABLED',
    true
  );

  const rmGroupSessionId = String(
    env.PAYMENT_RM_GROUP_SESSION_ID || ''
  ).trim();

  const csdGroupEnabled = booleanSetting(env, 'PAYMENT_CSD_GROUP_ENABLED', false);
  const csdGroup = cutoff(
    env.PAYMENT_CSD_GROUP_NOTIFY_SINCE || notify.text,
    'PAYMENT_CSD_GROUP_NOTIFY_SINCE'
  );
  const csdGroupName = String(env.PAYMENT_CSD_GROUP_NAME ?? 'CBL IT & CSD').trim();
  const csdGroupSessionId = String(env.PAYMENT_CSD_GROUP_SESSION_ID ?? 'BT').trim();
  if (csdGroupEnabled && (!csdGroupName || !csdGroupSessionId)) {
    throw new Error('PAYMENT CSD group name and session must not be empty');
  }

  return {
    messageType: 'PAYMENT',
    testGroup: String(env.PAYMENT_TEST_GROUP || '').trim(),
    csdGroupEnabled,
    csdGroupName,
    csdGroupSessionId,
    csdGroupSince: csdGroup.date,
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
    financeGroupSessionId: String(env.PAYMENT_FINACC_GROUP_SESSION_ID || '').trim(),
    testGroupSessionId: String(env.PAYMENT_TEST_GROUP_SESSION_ID || '').trim(),
    groupEnabled
  };
}

module.exports = { config };

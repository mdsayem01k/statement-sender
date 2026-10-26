const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, Date, Intl, setTimeout, setInterval, clearInterval,
    process: { env: { FINACC_GROUP_NOTIFY_SINCE: '2026-10-14T10:15:00' } },
    console: { log() {}, warn() {}, error() {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(require.resolve(name, { paths: [path.dirname(filename)] }))
  });
  return module.exports;
}
function fixture({ smsFails = false, groupFails = false, alreadySent = false, inserted = '2026-10-14T10:20:00Z' } = {}) {
  const calls = []; const audits = []; const flags = []; const states = new Map();
  const axios = { post: async (url, body) => {
    calls.push({ url, body });
    if (url.endsWith('send-text-to-group')) return { data: { success: !groupFails, error: 'Group rejected' } };
    return { data: { success: body.recipientJid !== '8801700000000', error: 'No WhatsApp account' } };
  } };
  const WA = load('backend/src/channels/WhatsAppChannel.js', { axios });
  const Group = load('backend/src/channels/WhatsAppGroupChannel.js', { axios });
  const MC = load('backend/src/services/MessageCenter.js');
  const config = { baseUrl: 'http://mock', sessionId: 'test', AccgroupName: 'Finance', timeoutMs: 1000 };
  const center = new MC({
    templates: { PAYMENT: { text: 'USER {{Investor}}', textRM: 'RM {{Investor}}' } },
    audit: { save: async e => audits.push(e) }, retryDelayMs: 0,
    chains: {
      MOBILE: [{ channel: new WA(config), attempts: 1 }, { channel: { name: 'SMS', accepts: () => true, send: async body => { calls.push({ url: 'SMS', body }); if (smsFails) throw new Error('SMS failed'); return { success: true }; } }, attempts: 1 }],
      GROUP: [{ channel: new Group(config), attempts: 1 }]
    }
  });
  const ledger = {
    module: 'PAYMENT:dbo.WithdrawalRequestNotification',
    async claim(id, role, via) { const key = `${id}:${role}:${via}`; const existing = states.get(key); if (existing && existing.state !== 'FAILED') return { key, allowed: false, ...existing }; states.set(key, { state: 'IN_FLIGHT' }); return { key, allowed: true }; },
    async record(c, state, channel) { states.set(c.key, { state, channel }); }
  };
  const Base = load('backend/src/core/NotificationJob.js', { '../services/DeliveryLedger': class {} });
  const Receipt = load('backend/src/modules/receipt/ReceiptNotificationJob.js', { '../../core/NotificationJob': Base });
  const row = { Id: 1, InvestorCode: '0015', CellNo: '01700000000', RmMobile: '01800000000', Email: null, RmEmail: null, Amount: 100, UrlCode: 'abcdef123', SourceInTimestamp: new Date(inserted), NotificationInsertDate: new Date(inserted), IsSentSms: alreadySent, IsSentEmail: true, RetryCount: 0 };
  const repository = { table: 'dbo.WithdrawalRequestNotification', findUnsent: async () => [row], doneRecipients: async () => new Set(), markSent: async (...v) => flags.push(['investor', ...v]), markRecipientSent: async (...v) => flags.push(['extra', ...v]), markFailed: async () => {}, markRecipientFailed: async () => {} };
  const job = new Receipt({ type: 'PAYMENT', name: 'PAYMENT', repository, deliveryLedger: ledger, ctx: { env: { notify: { emailEnabled: false } }, messageCenter: center }, link: c => c, notifyRm: false });
  return { job, row, calls, states, flags, audits };
}
test('investor WhatsApp failure and SMS success still send RM and group textRM', async () => {
  const f = fixture(); await f.job.sendPending();
  assert.equal(f.calls.filter(c => c.url === 'SMS').length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith('send-text')).length, 2);
  const group = f.calls.filter(c => c.url.endsWith('send-text-to-group'));
  assert.equal(group.length, 1); assert.equal(group[0].body.message, 'RM 0015');
  assert.equal(f.calls.find(c => c.body.recipientJid === '8801800000000').body.message, 'RM 0015');
  assert.equal(f.flags.some(v => v[2] === 'FINACC' && v[3] === 'GROUP'), true);
});
test('both investor mobile channels failing do not block RM or Finance group', async () => {
  const f = fixture({ smsFails: true }); await f.job.sendPending();
  assert.equal(f.states.get('1:INVESTOR:MOBILE').state, 'UNKNOWN');
  assert.equal(f.states.get('1:RM:MOBILE').state, 'SENT');
  assert.equal(f.states.get('1:FINACC:GROUP').state, 'SENT');
});
test('two workers cannot duplicate the independent group delivery', async () => {
  const f = fixture(); await Promise.all([f.job.sendPending(), f.job.sendPending()]);
  assert.equal(f.calls.filter(c => c.url.endsWith('send-text-to-group')).length, 1);
});
test('already sent investor does not block an unsent group notification', async () => {
  const f = fixture({ alreadySent: true }); await f.job.sendPending();
  assert.equal(f.calls.filter(c => c.url === 'SMS').length, 0);
  assert.equal(f.calls.filter(c => c.url.endsWith('send-text-to-group')).length, 1);
});
test('explicit group failure is tracked separately without repeating investor SMS', async () => {
  const f = fixture({ groupFails: true }); await f.job.sendPending(); await f.job.sendPending();
  assert.equal(f.calls.filter(c => c.url === 'SMS').length, 1);
  assert.equal(f.states.get('1:FINACC:GROUP').state, 'FAILED');
  assert.equal(f.calls.filter(c => c.url.endsWith('send-text-to-group')).length, 2);
});
test('group start timestamp prevents unsolicited historical group backfill', async () => {
  const f = fixture({ inserted: '2026-10-13T12:00:00Z' }); await f.job.sendPending();
  assert.equal(f.calls.filter(c => c.url.endsWith('send-text-to-group')).length, 0);
});

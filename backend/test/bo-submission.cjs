const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
function load(file, mocks = {}, env = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Date, Intl, Buffer, setTimeout, setInterval, clearInterval,
    process: { env }, console: { log() {}, warn() {}, error() {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(require.resolve(name, { paths: [path.dirname(filename)] }))
  });
  return module.exports;
}
function moduleWith(env) {
  const C = class {};
  const Module = load('backend/src/modules/boRegistration/index.js', {
    '../../core/PdfDocumentModule': class { constructor(options) { Object.assign(this, options); } },
    '../../core/PdfDiskCache': C,
    '../../config/paths': { BO_PDF_DIR: '/mock' },
    './BoRegistrationRepository': C,
    './BoStepRepository': C,
    './BoApplicationService': C,
    './BoDocumentFiles': {},
    './BoStepSyncJob': class { constructor(options) { Object.assign(this, options); } }
  }, env);
  return new Module({});
}
test('notification cutoff preserves the SQL local-clock timestamp across server time zones', () => {
  const m = moduleWith({ BO_NOTIFY_SINCE: '2026-10-14T10:15:00' });
  assert.equal(m.job.notifySince.toISOString(), '2026-10-14T10:15:00.000Z');
  assert.equal(m.job.syncSince.toISOString(), m.job.notifySince.toISOString());
  assert.equal(m.type, 'BO_REGISTRATION');
  assert.equal(m.linkTemplate, '/api/bo/reg/report/pdf?BOID={code}');
});
test('missing, invalid, or out-of-order cutoffs fail before sending', () => {
  assert.throws(() => moduleWith({}), /BO_NOTIFY_SINCE is required/);
  assert.throws(() => moduleWith({ BO_NOTIFY_SINCE: '2026-02-31T10:15:00' }), /not a valid/);
  assert.throws(() => moduleWith({ BO_NOTIFY_SINCE: '2026-10-14T10:15:00', BO_SYNC_SINCE: '2026-10-15T10:15:00' }), /must not be later/);
});
const Base = load('backend/src/core/NotificationJob.js', { '../services/DeliveryLedger': class {} });
const Job = load('backend/src/modules/boRegistration/BoStepSyncJob.js', { '../../core/NotificationJob': Base });
function jobFor(repository) {
  return new Job({ type: 'BO_REGISTRATION', name: 'BO_REGISTRATION', repository,
    notifySince: new Date('2026-10-14T10:15:00Z'), link: code => `PDF:${code}`,
    ctx: { env: { notify: { emailEnabled: true } }, messageCenter: {} },
    deliveryLedger: { module: 'BO_REGISTRATION:dbo.BoStepNotification' }
  });
}
test('failed older insert is retried even after a newer submission succeeds', async () => {
  const saved = new Map(); let first = true; let calls = 0;
  const rows = [{ BORegistrationMasterID: 1, BORegistrationNo: 'BO1' }, { BORegistrationMasterID: 2, BORegistrationNo: 'BO2' }];
  const repo = {
    fetchStep9FromSource: async since => { assert.equal(since.toISOString(), '2026-10-14T10:15:00.000Z'); calls++; return rows; },
    getExistingMasterIds: async () => new Set(saved.keys()),
    insertRow: async row => { if (row.BORegistrationMasterID === 1 && first) throw new Error('temporary failure'); if (saved.has(row.BORegistrationMasterID)) return 0; saved.set(row.BORegistrationMasterID, row); return 1; },
    isDuplicateUrlCode: () => false,
    findWithoutUrlCode: async () => []
  };
  const job = jobFor(repo); await job.syncSource(); assert.equal(saved.has(1), false); assert.equal(saved.has(2), true);
  const existingUrl = saved.get(2).UrlCode; first = false; await job.syncSource();
  assert.equal(saved.has(1), true); assert.equal(saved.get(2).UrlCode, existingUrl); assert.equal(calls, 2);
});
test('existing submissions keep their URL and send flags', async () => {
  let inserts = 0;
  const repo = { fetchStep9FromSource: async () => [{ BORegistrationMasterID: 1 }], getExistingMasterIds: async () => new Set([1]), insertRow: async () => { inserts++; }, findWithoutUrlCode: async () => [] };
  const result = await jobFor(repo).syncSource(); assert.equal(inserts, 0); assert.equal(result.alreadySynced, 1);
});
test('BO selects the first contact and uses database submission time in the template', () => {
  const job = jobFor({}); const row = { CellNo: '01700000000,01800000000', Email: 'a@example.com,b@example.com', BORegistrationNo: 'BO1', UrlCode: 'abcdef', StepDate: new Date('2026-10-14T10:15:00Z') };
  assert.equal(job.buildRecipient(row).mobile, '01700000000'); assert.equal(job.buildRecipient(row).email, 'a@example.com');
  assert.equal(job.buildData(row).dateTime, '14 Oct 2026 ||10:15AM'); assert.equal(job.buildData(row).url, 'PDF:abcdef');
  assert.equal(job.notifyRm, false); assert.equal(job.notifyGroup, false);
});
test('PDF URL lookup uses the same BoStepNotification table as the sync', async () => {
  let query, poolName, token;
  const Db = { sql: { VarChar: () => 'varchar' }, pool: async name => { poolName = name; return { request: () => ({ input(name, type, value) { token = value; return this; }, async query(sql) { query = sql; return { recordset: [{ id: 2821 }] }; } }) }; } };
  const Repo = load('backend/src/modules/boRegistration/BoRegistrationRepository.js', { '../../core/Db': Db });
  assert.equal(await new Repo().findMasterIdByUrlCode('abcdef'), 2821); assert.equal(poolName, 'poolPromise'); assert.equal(token, 'abcdef'); assert.match(query, /dbo.BoStepNotification WHERE UrlCode/);
});

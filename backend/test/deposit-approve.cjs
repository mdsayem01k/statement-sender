const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { config } = require('../src/modules/depositApprove/config');
const root = path.resolve(__dirname, '../src');
function load(file, mocks = {}) {
  const filename = path.join(root, file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), {
    module, Date, Buffer, setTimeout, process: { env: {} }, console: {log(){},warn(){},error(){}},
    require: name => Object.hasOwn(mocks,name) ? mocks[name] : require(require.resolve(name,{paths:[path.dirname(filename)]}))
  });
  return module.exports;
}
const Base = load('core/NotificationJob.js', {'../services/DeliveryLedger': class {}});
const Receipt = load('modules/receipt/ReceiptNotificationJob.js', {'../../core/NotificationJob':Base});
const ReqJob = load('modules/depositReq/DepositReqNotificationJob.js', {'../receipt/ReceiptNotificationJob':Receipt});
const Job = load('modules/depositApprove/DepositApproveJob.js', {'../depositReq/DepositReqNotificationJob':ReqJob});
function fixture(env = {}, { investorReject = false, timeout = false, smsReject = false } = {}) {
  const settings = config({ DEPOSITAPPROVE_NOTIFY_SINCE:'2026-10-25T00:00:00', DEPOSITAPPROVE_RM_GROUP_ENABLED:'true', ...env });
  const calls = [], states = new Map(), done = new Set();
  const axios = {post: async (url,body) => {
    calls.push({channel:url.endsWith('send-text-to-group')?(body.groupName==='RM Test'?'RM_GROUP':'GROUP'):'WHATSAPP',body});
    if (timeout && body.recipientJid==='8801700000000') throw new Error('Timeout');
    return {data:{success: !(investorReject && body.recipientJid==='8801700000000'),error:'Not on WhatsApp'}};
  }};
  const Group = load('channels/WhatsAppGroupChannel.js',{axios});
  const GroupVA = load('modules/depositReq/DepositReqGroupChannel.js',{axios});
  const Center = load('modules/depositReq/DepositReqMessageCenter.js',{axios,'./DepositReqGroupChannel':GroupVA});
  const shared = {
    templates:require('../src/config/messageTemplates.json'), audit:{save:async()=>{}}, testMobile:'',testEmail:'',
    chains:{
      MOBILE:[
        {channel:{name:'WHATSAPP',config:{baseUrl:'http://mock',sessionId:'test',timeoutMs:1000},accepts:r=>Boolean(r.mobile)}},
        {channel:{name:'SMS',accepts:r=>Boolean(r.mobile),send:async payload=>{
          calls.push({channel:'SMS',body:payload});
          if (smsReject) {const e=new Error('Rejected before sending');e.definitelyNotSent=true;throw e;}
          return {success:true};
        }}}
      ],
      EMAIL:[{channel:{name:'EMAIL',accepts:r=>Boolean(r.email),send:async payload=>{calls.push({channel:'EMAIL',body:payload});return {success:true};}}}],
      GROUP:[{channel:new Group({baseUrl:'http://mock',timeoutMs:1000})}]
    }
  };
  const center=new Center(shared,settings);
  const row={Id:1,InvestorCode:'0015',Descriptions:'Payment mode: BEFTN',SourcePaymentID:'42',CellNo:'01700000000,01900000000',Email:'user@example.test',RmMobile:'01800000000,01600000000',RmEmail:'rm@example.test',RmWhatsappGroup:'RM Test',SourceInTimestamp:new Date('2026-10-25T10:15:00Z'),Amount:100,UrlCode:'abcdef123'};
  const repository={table:'dbo.ChequeNotification',findUnsent:async()=>[row],doneRecipients:async()=>done,
    markSent:async(id,via)=>{if(via==='MOBILE')row.IsSentSms=true;else row.IsSentEmail=true;},
    markRecipientSent:async(id,role,via)=>done.add(`${id}:${role}:${via}`),markFailed:async()=>{},markRecipientFailed:async()=>{}};
  const ledger={module:'DEPOSIT_APPROVE:dbo.DepositApproveNotification',claim:async(id,role,via)=>{
    const key=`${id}:${role}:${via}`,state=states.get(key);
    if(state && state!=='FAILED')return {key,allowed:false,state};
    states.set(key,'IN_FLIGHT');return {key,allowed:true};
  },record:async(claim,state)=>states.set(claim.key,state)};
  const job=new Job({settings,type:'DEPOSIT_APPROVE',name:'DEPOSIT_APPROVE',repository,deliveryLedger:ledger,ctx:{env:{notify:{emailEnabled:true}},messageCenter:center},link:c=>'PDF:'+c});
  return {job,row,calls,states,settings,center};
}
test('cutoffs are strict SQL wall clocks and synchronization cannot start after notification cutoff',()=>{
  assert.throws(()=>config({}),/DEPOSITAPPROVE_NOTIFY_SINCE/);
  assert.throws(()=>config({DEPOSITAPPROVE_NOTIFY_SINCE:'2026-02-30T10:00:00'}),/Invalid/);
  assert.throws(()=>config({DEPOSITAPPROVE_NOTIFY_SINCE:'2026-10-25T10:00:00',DEPOSITAPPROVE_SYNC_SINCE:'2026-10-25T11:00:00'}),/must not be later/);
  assert.equal(config({DEPOSITAPPROVE_NOTIFY_SINCE:'2026-10-25T10:15:00'}).notifySince.toISOString(),'2026-10-25T10:15:00.000Z');
  assert.throws(()=>config({DEPOSITAPPROVE_NOTIFY_SINCE:'2026-10-25T00:00:00',DEPOSITAPPROVE_RM_GROUP_ENABLED:'yes'}),/true or false/);
});
test('WhatsApp-only sends independently to investor RM and group with no SMS or email',async()=>{
  const f=fixture();await f.job.sendPending();await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['WHATSAPP','RM_GROUP','GROUP']);
  assert.match(f.calls[1].body.message,/Investor/);assert.match(f.calls[2].body.message,/25 Oct 2026/);
});
test('investor rejection does not block RM or group when SMS is disabled',async()=>{
  const f=fixture({}, {investorReject:true});await f.job.sendPending();
  assert.equal(f.states.get('1:INVESTOR:MOBILE'),'FAILED');assert.equal(f.states.get('1:RM_GROUP:GROUP'),'SENT');assert.equal(f.states.get('1:FINACC:GROUP'),'SENT');
});
test('confirmed WhatsApp rejection falls back to SMS while RM and group continue independently',async()=>{
  const f=fixture({DEPOSITAPPROVE_SMS_ENABLED:'true'}, {investorReject:true});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['WHATSAPP','SMS','RM_GROUP','GROUP']);
});
test('SMS-first ordering is respected and confirmed SMS rejection can fall back to WhatsApp',async()=>{
  const f=fixture({DEPOSITAPPROVE_MOBILE_FIRST:'SMS',DEPOSITAPPROVE_SMS_ENABLED:'true'}, {smsReject:true});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['SMS','WHATSAPP','RM_GROUP','GROUP']);
});
test('uncertain investor timeout does not fall back or resend but RM and group still progress',async()=>{
  const f=fixture({DEPOSITAPPROVE_SMS_ENABLED:'true'}, {timeout:true});await f.job.sendPending();await f.job.sendPending();
  assert.equal(f.calls.filter(c=>c.channel==='SMS').length,0);assert.equal(f.states.get('1:INVESTOR:MOBILE'),'UNKNOWN');
  assert.equal(f.calls.length,3);
});
test('RM and group toggles disable those recipients without disabling the investor',async()=>{
  const f=fixture({DEPOSITAPPROVE_RM_GROUP_ENABLED:'false',DEPOSITAPPROVE_FINACC_GROUP_ENABLED:'false'});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['WHATSAPP']);
});
test('email-only sends investor email while both groups and mobile are disabled',async()=>{
  const f=fixture({DEPOSITAPPROVE_WHATSAPP_ENABLED:'false',DEPOSITAPPROVE_FINACC_GROUP_ENABLED:'false',DEPOSITAPPROVE_EMAIL_ENABLED:'true',DEPOSITAPPROVE_RM_GROUP_ENABLED:'false'});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['EMAIL']);
});
test('group WhatsApp is independent of disabled investor/RM mobile channels',async()=>{
  const f=fixture({DEPOSITAPPROVE_WHATSAPP_ENABLED:'false'});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['RM_GROUP','GROUP']);
});
test('database source cutoff excludes older pending rows and separate group cutoff prevents group backfill',async()=>{
  const old=fixture();old.row.SourceInTimestamp=new Date('2026-10-24T23:59:59Z');await old.job.sendPending();assert.equal(old.calls.length,0);
  const f=fixture({DEPOSITAPPROVE_FINACC_GROUP_NOTIFY_SINCE:'2026-10-25T11:00:00'});await f.job.sendPending();assert.equal(f.calls.filter(c=>c.channel==='GROUP').length,0);
});

test('RM group can be disabled independently during investor email-only mode',async()=>{
  const f=fixture({DEPOSITAPPROVE_WHATSAPP_ENABLED:'false',DEPOSITAPPROVE_FINACC_GROUP_ENABLED:'false',DEPOSITAPPROVE_RM_GROUP_ENABLED:'false',DEPOSITAPPROVE_EMAIL_ENABLED:'true'});
  await f.job.sendPending();assert.equal(f.calls.length,1);assert.equal(f.calls[0].channel,'EMAIL');assert.equal(f.calls[0].body.recipient.role,'INVESTOR');
});
test('all delivery channels disabled sends nothing and does not select pending work',async()=>{
  const f=fixture({DEPOSITAPPROVE_WHATSAPP_ENABLED:'false',DEPOSITAPPROVE_FINACC_GROUP_ENABLED:'false',DEPOSITAPPROVE_RM_GROUP_ENABLED:'false'});
  f.job.repository.findUnsent=async()=>{throw new Error('must not select disabled work');};
  await f.job.sendPending();assert.equal(f.calls.length,0);
});

test('RM group receives internal text and personal RM contacts are not used',async()=>{
  const f=fixture(); await f.job.sendPending();
  const rm=f.calls.find(c=>c.channel==='RM_GROUP');
  assert.equal(rm.body.groupName,'RM Test'); assert.match(rm.body.message,/Investor/);
  assert.equal(f.calls.filter(c=>c.body.recipientJid==='8801800000000').length,0);
  assert.equal(f.states.get('1:RM_GROUP:GROUP'),'SENT');
});
test('RM group cutoff can exclude older records without preventing Finance group delivery',async()=>{
  const f=fixture({DEPOSITAPPROVE_RM_GROUP_NOTIFY_SINCE:'2026-10-25T11:00:00'});await f.job.sendPending();
  assert.equal(f.calls.filter(c=>c.channel==='RM_GROUP').length,0);
  assert.equal(f.calls.filter(c=>c.channel==='GROUP').length,1);
});

test('RM group is selected from each pending database row, not a global name',async()=>{
  const f=fixture(); f.row.RmWhatsappGroup='RM Trader 002'; await f.job.sendPending();
  assert.ok(f.calls.some(c=>c.body.groupName==='RM Trader 002'));
  assert.equal(f.calls.some(c=>c.body.groupName==='RM Test'),false);
});
test('missing RM group mapping skips only RM group while investor and finance progress',async()=>{
  const f=fixture(); f.row.RmWhatsappGroup=null; await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['WHATSAPP','GROUP']);
});

test('demo override sends one internal group copy and preserves real group delivery state', async () => {
  const f = fixture({ DEPOSITAPPROVE_TEST_GROUP: 'demo group' });
  f.row.RmWhatsappGroup = null;
  await Promise.all([f.job.sendPending(), f.job.sendPending()]);
  await f.job.sendPending();
  const groups = f.calls.filter(c => c.body.groupName);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].body.groupName, 'demo group');
  assert.match(groups[0].body.message, /has been approved/);
  assert.equal(f.states.get('1:DEMO_GROUP:GROUP'), 'SENT');
  assert.equal(f.states.has('1:RM_GROUP:GROUP'), false);
  assert.equal(f.states.has('1:FINACC:GROUP'), false);
  f.settings.testGroup = '';
  f.row.RmWhatsappGroup = 'RM Test';
  await f.job.sendPending();
  assert.equal(f.states.get('1:RM_GROUP:GROUP'), 'SENT');
  assert.equal(f.states.get('1:FINACC:GROUP'), 'SENT');
});

test('demo override respects group switches and eligible source cutoffs', async () => {
  const disabled = fixture({ DEPOSITAPPROVE_TEST_GROUP: 'demo group', DEPOSITAPPROVE_RM_GROUP_ENABLED: 'false', DEPOSITAPPROVE_FINACC_GROUP_ENABLED: 'false' });
  await disabled.job.sendPending();
  assert.equal(disabled.calls.filter(c => c.body.groupName).length, 0);
  const later = fixture({ DEPOSITAPPROVE_TEST_GROUP: 'demo group', DEPOSITAPPROVE_RM_GROUP_NOTIFY_SINCE: '2026-10-25T11:00:00', DEPOSITAPPROVE_FINACC_GROUP_NOTIFY_SINCE: '2026-10-25T11:00:00' });
  await later.job.sendPending();
  assert.equal(later.calls.filter(c => c.body.groupName).length, 0);
});

test('failed RM group does not block finance or repeat accepted investor delivery', async () => {
  const f = fixture();
  const channel = f.center.chains.GROUP[0].channel;
  const original = channel.send.bind(channel);
  channel.send = async payload => {
    if (payload.recipient.role === 'RM_GROUP') {
      const error = new Error('Group rejected');
      error.definitelyNotSent = true;
      throw error;
    }
    return original(payload);
  };
  await f.job.sendPending();
  await f.job.sendPending();
  assert.equal(f.states.get('1:RM_GROUP:GROUP'), 'FAILED');
  assert.equal(f.states.get('1:FINACC:GROUP'), 'SENT');
  assert.equal(f.calls.filter(c => c.channel === 'WHATSAPP').length, 1);
  assert.equal(f.calls.filter(c => c.body.groupName).length, 1);
});


function repositoryFixture({ keys = [{ ColumnName: 'PaymentID', DataType: 'bigint' }], sourceRows = [], existing = [] } = {}) {
  const queries = [];
  const bindings = {};
  const request = kind => ({
    input(name, type, value) { bindings[`${kind}:${name}`] = value; return this; },
    async query(text) {
      queries.push({ kind, text });
      if (text.includes('sys.indexes ix')) return { recordset: keys };
      if (text.includes('DECLARE @businessDate')) return { recordset: sourceRows };
      if (text.includes('SELECT SourcePaymentID')) return { recordset: existing };
      return { recordset: [], rowsAffected: [1] };
    }
  });
  const sql = { Int: {}, DateTime: {}, Decimal: () => {}, NVarChar: () => {}, VarChar: () => {} };
  const Db = { sql, pool: async kind => ({ request: () => request(kind === 'XBpoolPromise' ? 'source' : 'local') }) };
  const Parent = load('modules/receipt/ReceiptRepository.js', {
    '../../core/Db': Db,
    '../../core/NotificationRepository': class {
      constructor(options) { Object.assign(this, options); this.bare = this.table.split('.').pop(); }
      pool() { return Db.pool('poolPromise'); }
    }
  });
  const Repo = load('modules/depositApprove/DepositApproveRepository.js', {
    '../../core/Db': Db,
    '../receipt/ReceiptRepository': Parent,
    '../depositReq/ChequeRepository': class { findUnsent(options) { return options; } }
  });
  const settings = config({ DEPOSITAPPROVE_NOTIFY_SINCE: '2026-10-25T00:00:00' });
  return { repo: new Repo(settings), queries, bindings };
}

test('approval sync uses source PK and exact deposit/mode filters while recovering older eligible dates', async () => {
  const f = repositoryFixture({ sourceRows: [{ SourcePaymentID: '40' }, { SourcePaymentID: '42' }], existing: [{ SourcePaymentID: '40' }] });
  const rows = await f.repo.fetchNewFromSource();
  assert.deepEqual(Array.from(rows, r => r.SourcePaymentID), ['42']);
  const source = f.queries.find(q => q.text.includes('DECLARE @businessDate')).text;
  assert.match(source, /p\.paymentID/);
  assert.match(source, /p.PaymentTypeID = 1/);
  assert.match(source, /p.PayModeID NOT IN \(4, 8\)/);
  assert.match(source, /DATEADD\(DAY, 1, MAX\(EODDate\)\)/);
  assert.match(source, /p.PaymentDate >= CONVERT/);
  assert.match(source, /p.PaymentDate < DATEADD\(DAY, 1, @businessDate\)/);
  assert.doesNotMatch(source, /@last|MAX\(PaymentID\)/);
  assert.equal(f.bindings['source:since'], '2026-10-25T00:00:00');
  await f.repo.fetchNewFromSource();
  assert.equal(f.queries.filter(q => q.text.includes('DECLARE @businessDate')).length, 2);
});


test('approval storage has its own source uniqueness and atomic duplicate guard', async () => {
  const f = repositoryFixture();
  const ddl = f.repo.ddl();
  assert.match(ddl, /ApprovalID INT IDENTITY\(1,1\) NOT NULL PRIMARY KEY/);
  assert.match(ddl, /SourcePaymentID NVARCHAR\(100\) NOT NULL/);
  assert.match(ddl, /UNIQUE \(SourcePaymentID\)/);
  assert.match(ddl, /dbo.DepositApproveNotification/);
  await f.repo.insertSyncRow({ SourcePaymentID: '2147483648', InvestorID: 1, InvestorCode: '0015', CellNo: '01700000000,01800000000', Email: 'one@example.test,two@example.test', ReceiveDate: new Date('2026-10-25T00:00:00Z'), Amount: 100, Descriptions: 'Payment mode: BEFTN', Trader: 'RM001' });
  assert.equal(f.bindings['local:source'], '2147483648');
  assert.equal(f.bindings['local:mobile'], '01700000000');
  assert.equal(f.bindings['local:email'], 'one@example.test');
  assert.match(f.queries.at(-1).text, /WITH \(UPDLOCK, HOLDLOCK\)/);
});

test('failed approval insert is retried on the next scan without blocking later rows', async () => {
  const f = fixture();
  const stored = new Set();
  let fail = true;
  f.job.repository.fetchNewFromSource = async () => [{ SourcePaymentID: '1' }, { SourcePaymentID: '2' }].filter(r => !stored.has(r.SourcePaymentID));
  f.job.repository.insertSyncRow = async row => {
    if (row.SourcePaymentID === '1' && fail) { fail = false; throw new Error('DB failed'); }
    stored.add(row.SourcePaymentID); return 1;
  };
  f.job.repository.findWithoutNotification = async () => [];
  assert.equal((await f.job.syncSource()).failed, 1);
  assert.equal((await f.job.syncSource()).stored, 1);
  assert.equal(stored.size, 2);
});

test('approval template shows database payment date without claiming an approval time', () => {
  const f = fixture();
  const data = f.job.buildData(f.row);
  assert.equal(data.paymentDate, '25 Oct 2026');
  assert.equal(data.paymentMode, 'Payment mode: BEFTN');
  assert.equal(f.job.buildRecipients(f.row).some(r => r.role === 'RM'), false);
});

test('approval is a separate pipeline and audit module', () => {
  const registry = fs.readFileSync(path.join(root, 'core/ModuleRegistry.js'), 'utf8');
  assert.match(registry, /'DEPOSIT_APPROVE'/);
  const { classifyAuditEvent } = require('../src/utils/auditEvents');
  assert.equal(classifyAuditEvent({ status: 'DEPOSIT_APPROVE_SMS_SENT' }, new Set()), 'notification');
  const boot = fs.readFileSync(path.join(root, 'bootstrap/modules.js'), 'utf8');
  assert.match(boot, /DEPOSITAPPROVE_ENABLED/);
  assert.match(boot, /require\('\.\.\/modules\/depositVA'\)/);
});

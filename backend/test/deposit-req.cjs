const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { config } = require('../src/modules/depositReq/config');
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
const Job = load('modules/depositReq/DepositReqNotificationJob.js', {'../receipt/ReceiptNotificationJob':Receipt});
function fixture(env = {}, { investorReject = false, timeout = false, smsReject = false } = {}) {
  const settings = config({ DEPOSITREQ_NOTIFY_SINCE:'2026-10-25T00:00:00', DEPOSITREQ_RM_GROUP_ENABLED:'true', ...env });
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
  const row={Id:1,InvestorCode:'0015',CellNo:'01700000000,01900000000',Email:'user@example.test',RmMobile:'01800000000,01600000000',RmEmail:'rm@example.test',RmWhatsappGroup:'RM Test',SourceInTimestamp:new Date('2026-10-25T10:15:00Z'),Amount:100,UrlCode:'abcdef123'};
  const repository={table:'dbo.ChequeNotification',findUnsent:async()=>[row],doneRecipients:async()=>done,
    markSent:async(id,via)=>{if(via==='MOBILE')row.IsSentSms=true;else row.IsSentEmail=true;},
    markRecipientSent:async(id,role,via)=>done.add(`${id}:${role}:${via}`),markFailed:async()=>{},markRecipientFailed:async()=>{}};
  const ledger={module:'RECEIPTREQ:dbo.depositReqNotification',claim:async(id,role,via)=>{
    const key=`${id}:${role}:${via}`,state=states.get(key);
    if(state && state!=='FAILED')return {key,allowed:false,state};
    states.set(key,'IN_FLIGHT');return {key,allowed:true};
  },record:async(claim,state)=>states.set(claim.key,state)};
  const job=new Job({settings,type:'RECEIPTREQ',name:'RECEIPTREQ',repository,deliveryLedger:ledger,ctx:{env:{notify:{emailEnabled:true}},messageCenter:center},link:c=>'PDF:'+c});
  return {job,row,calls,states,settings,center};
}
test('cutoffs are strict SQL wall clocks and synchronization cannot start after notification cutoff',()=>{
  assert.throws(()=>config({}),/DEPOSITREQ_NOTIFY_SINCE/);
  assert.throws(()=>config({DEPOSITREQ_NOTIFY_SINCE:'2026-02-30T10:00:00'}),/Invalid/);
  assert.throws(()=>config({DEPOSITREQ_NOTIFY_SINCE:'2026-10-25T10:00:00',DEPOSITREQ_SYNC_SINCE:'2026-10-25T11:00:00'}),/must not be later/);
  assert.equal(config({DEPOSITREQ_NOTIFY_SINCE:'2026-10-25T10:15:00'}).notifySince.toISOString(),'2026-10-25T10:15:00.000Z');
  assert.throws(()=>config({DEPOSITREQ_NOTIFY_SINCE:'2026-10-25T00:00:00',DEPOSITREQ_RM_GROUP_ENABLED:'yes'}),/true or false/);
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
  const f=fixture({DEPOSITREQ_SMS_ENABLED:'true'}, {investorReject:true});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['WHATSAPP','SMS','RM_GROUP','GROUP']);
});
test('SMS-first ordering is respected and confirmed SMS rejection can fall back to WhatsApp',async()=>{
  const f=fixture({DEPOSITREQ_MOBILE_FIRST:'SMS',DEPOSITREQ_SMS_ENABLED:'true'}, {smsReject:true});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['SMS','WHATSAPP','RM_GROUP','GROUP']);
});
test('uncertain investor timeout does not fall back or resend but RM and group still progress',async()=>{
  const f=fixture({DEPOSITREQ_SMS_ENABLED:'true'}, {timeout:true});await f.job.sendPending();await f.job.sendPending();
  assert.equal(f.calls.filter(c=>c.channel==='SMS').length,0);assert.equal(f.states.get('1:INVESTOR:MOBILE'),'UNKNOWN');
  assert.equal(f.calls.length,3);
});
test('RM and group toggles disable those recipients without disabling the investor',async()=>{
  const f=fixture({DEPOSITREQ_RM_GROUP_ENABLED:'false',DEPOSITREQ_FINACC_GROUP_ENABLED:'false'});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['WHATSAPP']);
});
test('email-only sends investor email while both groups and mobile are disabled',async()=>{
  const f=fixture({DEPOSITREQ_WHATSAPP_ENABLED:'false',DEPOSITREQ_FINACC_GROUP_ENABLED:'false',DEPOSITREQ_EMAIL_ENABLED:'true',DEPOSITREQ_RM_GROUP_ENABLED:'false'});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['EMAIL']);
});
test('group WhatsApp is independent of disabled investor/RM mobile channels',async()=>{
  const f=fixture({DEPOSITREQ_WHATSAPP_ENABLED:'false'});await f.job.sendPending();
  assert.deepEqual(f.calls.map(c=>c.channel),['RM_GROUP','GROUP']);
});
test('database source cutoff excludes older pending rows and separate group cutoff prevents group backfill',async()=>{
  const old=fixture();old.row.SourceInTimestamp=new Date('2026-10-24T23:59:59Z');await old.job.sendPending();assert.equal(old.calls.length,0);
  const f=fixture({DEPOSITREQ_FINACC_GROUP_NOTIFY_SINCE:'2026-10-25T11:00:00'});await f.job.sendPending();assert.equal(f.calls.filter(c=>c.channel==='GROUP').length,0);
});
test('source and pending SQL bind cutoff and channel settings before selecting eligible recipients',async()=>{
  const queries=[],bindings={};
  const Db={sql:{Int:{},Bit:{},DateTime:{},VarChar:()=>{},NVarChar:()=>{}},pool:async()=>({request(){return{input(k,t,v){bindings[k]=v;return this;},async query(sql){queries.push(sql);return{recordset:[]};}}}})};
  const Parent=class{constructor(options){Object.assign(this,options);this.pk='NotificationID';this.bare='ChequeNotification';}pool(){return Db.pool();}columns(){return'n.*';}};
  const Repo=load('modules/depositReq/ChequeRepository.js',{'../../core/Db':Db,'../receipt/ReceiptRepository':Parent,'../rm/RmRepository':class{attach(rows){return rows;}}});
  const settings=config({DEPOSITREQ_NOTIFY_SINCE:'2026-10-25T10:00:00',DEPOSITREQ_WHATSAPP_ENABLED:'false',DEPOSITREQ_FINACC_GROUP_ENABLED:'false',DEPOSITREQ_EMAIL_ENABLED:'true'});
  const repo=new Repo(settings);await repo.fetchNewFromSource(12);assert.equal(bindings.since,'2026-10-25T10:00:00');assert.match(queries[0],/d.InTimeStamp >= CONVERT/);
  await repo.findUnsent({limit:50,maxRetry:5,deliveryModule:'RECEIPT:dbo.ChequeNotification'});
  assert.equal(bindings.mobile,false);assert.equal(bindings.email,true);assert.equal(bindings.group,false);assert.match(queries[1],/s.SourceInTimestamp >= @since/);
});
test('RM group can be disabled independently during investor email-only mode',async()=>{
  const f=fixture({DEPOSITREQ_WHATSAPP_ENABLED:'false',DEPOSITREQ_FINACC_GROUP_ENABLED:'false',DEPOSITREQ_RM_GROUP_ENABLED:'false',DEPOSITREQ_EMAIL_ENABLED:'true'});
  await f.job.sendPending();assert.equal(f.calls.length,1);assert.equal(f.calls[0].channel,'EMAIL');assert.equal(f.calls[0].body.recipient.role,'INVESTOR');
});
test('all delivery channels disabled sends nothing and does not select pending work',async()=>{
  const f=fixture({DEPOSITREQ_WHATSAPP_ENABLED:'false',DEPOSITREQ_FINACC_GROUP_ENABLED:'false',DEPOSITREQ_RM_GROUP_ENABLED:'false'});
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
  const f=fixture({DEPOSITREQ_RM_GROUP_NOTIFY_SINCE:'2026-10-25T11:00:00'});await f.job.sendPending();
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
  const f = fixture({ DEPOSITREQ_TEST_GROUP: 'demo group' });
  f.row.RmWhatsappGroup = null;
  await Promise.all([f.job.sendPending(), f.job.sendPending()]);
  await f.job.sendPending();
  const groups = f.calls.filter(c => c.body.groupName);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].body.groupName, 'demo group');
  assert.match(groups[0].body.message, /submitted through the Web Portal/);
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
  const disabled = fixture({ DEPOSITREQ_TEST_GROUP: 'demo group', DEPOSITREQ_RM_GROUP_ENABLED: 'false', DEPOSITREQ_FINACC_GROUP_ENABLED: 'false' });
  await disabled.job.sendPending();
  assert.equal(disabled.calls.filter(c => c.body.groupName).length, 0);
  const later = fixture({ DEPOSITREQ_TEST_GROUP: 'demo group', DEPOSITREQ_RM_GROUP_NOTIFY_SINCE: '2026-10-25T11:00:00', DEPOSITREQ_FINACC_GROUP_NOTIFY_SINCE: '2026-10-25T11:00:00' });
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

test('SQL selects demo independently while excluding real groups in test mode', async () => {
  const bindings = {};
  let query = '';
  const Db = { sql: { Int: {}, Bit: {}, DateTime: {}, NVarChar: () => {} }, pool: async () => ({ request() { return { input(key, type, value) { bindings[key] = value; return this; }, async query(text) { query = text; return { recordset: [] }; } }; } }) };
  const Parent = class { constructor(options) { Object.assign(this, options); this.pk = 'NotificationID'; this.bare = 'depositReqNotification'; this.select = ''; this.join = ''; } pool() { return Db.pool(); } columns() { return 'n.*'; } };
  const Repo = load('modules/depositReq/ChequeRepository.js', { '../../core/Db': Db, '../receipt/ReceiptRepository': Parent, '../rm/RmRepository': class {} });
  const settings = config({ DEPOSITREQ_NOTIFY_SINCE: '2026-10-25T00:00:00', DEPOSITREQ_TEST_GROUP: 'demo group', DEPOSITREQ_RM_GROUP_ENABLED: 'true' });
  await new Repo(settings).findUnsent({ limit: 50, maxRetry: 5, deliveryModule: 'RECEIPTREQ:dbo.depositReqNotification' });
  assert.equal(bindings.demo, true);
  assert.equal(bindings.rmGroup, false);
  assert.equal(bindings.group, false);
  assert.match(query, /'DEMO_GROUP', 'GROUP'/);
  assert.match(query, /d.RecipientRole = v.Role/);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const esbuild = require(path.join(root,'frontend/node_modules/esbuild'));
const quiet = {log(){},warn(){},error(){}};
function load(relative,mocks={},jsx=false,globals={}) {
 const filename=path.join(root,relative); const mod={exports:{}};
 let source=fs.readFileSync(filename,'utf8');
 if(jsx) source=esbuild.transformSync(source,{loader:relative.endsWith('jsx')?'jsx':'js',format:'cjs',target:'es2020'}).code;
 const context={module:mod,exports:mod.exports,console:quiet,process:{env:{}},setTimeout,setInterval,clearInterval,Buffer,Date,Intl,URL,...globals};
 context.require=name=>Object.hasOwn(mocks,name)?mocks[name]:require(require.resolve(name,{paths:[path.dirname(filename)]}));
 vm.runInNewContext(source,context,{filename});return mod.exports;
}
function ledgerMemory(){
 const entries=new Map();
 return {module:'TEST:dbo.Test',entries,
  async claim(id,role,via){const key=`${id}:${role}:${via}`;const old=entries.get(key);if(old&&old.state!=='FAILED')return {key,allowed:false,...old};const r={owner:'owner',state:'IN_FLIGHT',channel:null};entries.set(key,r);return {key,allowed:true,...r};},
  async record(c,state,channel,error){const old=entries.get(c.key);entries.set(c.key,{...old,state,channel:channel||old.channel,error});}
 };
}
const Job=load('backend/src/core/NotificationJob.js',{'../services/DeliveryLedger':class {}});
class TestJob extends Job {buildRecipient(row){return {mobile:row.CellNo}}buildData(){return {url:'mock'}}}
function setup({sender,markSent,ledger=ledgerMemory()}={}) {
 let sends=0,failures=0,marks=0;
 const repository={table:'dbo.Test',poolName:'poolPromise',findUnsent:async()=>[{Id:1,CellNo:'01700000000',IsSentSms:false,IsSentEmail:true,RetryCount:0}],doneRecipients:async()=>new Set(),markSent:async()=>{marks++;if(markSent)await markSent()},markFailed:async()=>{failures++}};
 const options={name:'test',type:'TEST',repository,deliveryLedger:ledger,ctx:{env:{notify:{emailEnabled:false}},messageCenter:{send:async()=>{sends++;if(sender)return sender();return {channel:'SMS',messageText:'ok'}}}}};
 return {options,ledger,counts:()=>({sends,failures,marks})};
}
test('two workers send one pending recipient only once',async()=>{const s=setup();await Promise.all([new TestJob(s.options).run(),new TestJob(s.options).run()]);assert.equal(s.counts().sends,1);});
test('accepted delivery with failed DB flag is reconciled without sending again',async()=>{let blocked=true;const s=setup({markSent:async()=>{if(blocked)throw new Error('DB failed')}});const a=new TestJob(s.options);await a.run();assert.equal(s.counts().failures,0);assert.equal(s.ledger.entries.get('1:INVESTOR:MOBILE').state,'ACCEPTED');blocked=false;await new TestJob(s.options).run();assert.equal(s.counts().sends,1);assert.equal(s.counts().marks,2);});
test('failed ledger write after accepted send cannot resend',async()=>{const ledger=ledgerMemory();ledger.record=async()=>{throw new Error('DB failed')};const s=setup({ledger});await new TestJob(s.options).run();await new TestJob(s.options).run();assert.equal(s.counts().sends,1);assert.equal(s.counts().failures,0);});
test('uncertain provider timeout is held for review',async()=>{const s=setup({sender:async()=>{const e=new Error('timeout');e.statusCode=504;throw e}});await new TestJob(s.options).run();await new TestJob(s.options).run();assert.equal(s.counts().sends,1);assert.equal(s.ledger.entries.get('1:INVESTOR:MOBILE').state,'UNKNOWN');});
test('SMS quota rejection is saved as a known failure',async()=>{const s=setup({sender:async()=>{const e=new Error('quota');e.statusCode=429;e.errorType='SMS_DAILY_LIMIT';throw e}});s.options.type='TRADE_CONFIRMATION';await new TestJob(s.options).run();assert.equal(s.counts().failures,1);assert.equal(s.ledger.entries.get('1:INVESTOR:MOBILE').state,'FAILED');});
test('fallback quota after uncertain WhatsApp is not treated as safe to retry',async()=>{const s=setup({sender:async()=>{const e=new Error('WA timeout | SMS quota');e.statusCode=429;e.errorType='SMS_DAILY_LIMIT';throw e}});s.options.type='PORTFOLIO';await new TestJob(s.options).run();assert.equal(s.ledger.entries.get('1:INVESTOR:MOBILE').state,'UNKNOWN');});
test('independent recipient roles and channels have separate claims',async()=>{const s=setup();const job=new TestJob(s.options);const stats={failed:0};await job.deliver({Id:1},'MOBILE',{role:'INVESTOR'},stats);await job.deliver({Id:1},'EMAIL',{role:'INVESTOR'},stats);await job.deliver({Id:1},'MOBILE',{role:'RM'},stats);assert.equal(s.counts().sends,3);});
test('generation returns the database canonical link and deduplicates schedule investors',async()=>{const CodeMap=load('backend/src/modules/folderPdf/UrlCodeMapService.js');let insertions=0;const map=new CodeMap({repository:{insert:async()=>{insertions++;return 'existingUrl123'},expectedClientCodes:async()=>['0015','0015',' 0015 ','']},locator:{fileNameFor:c=>`${c}.pdf`}});const rows=await map.processSchedule(2);assert.equal(rows.length,1);assert.equal(rows[0].urlcode,'existingUrl123');assert.equal(insertions,1);assert.equal(await map.createEntry('0015'),'existingUrl123');});
test('historical send resolves exactly the selected URL code',async()=>{const Base=class{constructor(v){Object.assign(this,v)}routes(){return []}};const Module=load('backend/src/modules/folderPdf/FolderPdfModule.js',{'../../core/PdfDocumentModule':Base,'./PortfolioMapRepository':class{},'./PdfBatchCopier':class{},'./UrlCodeMapService':class{}});let selected,sent;
 const repo={findContactByCode:async(code,urlcode)=>{selected={code,urlcode};return {investor:code,encrypto_code:urlcode,mobile:'01700000000'}}};const m=new Module({type:'TRADE_CONFIRMATION',ctx:{env:{app:{pdfBaseUrl:'http://mock'}},audit:{save:async()=>{}},messageCenter:{send:async p=>{sent=p;return {channel:'SMS'}}}},repository:repo,locator:{},adminPrefix:'/report',notifyRoute:'/notify/trade-confirmation'});m.link=c=>`LINK:${c}`;const response={json(v){this.body=v;return this},status(){return this}};await m.sendByCode({query:{code:'0015',urlcode:'historic123'},params:{},ip:'test',get:()=>''},response,'mobile');assert.equal(selected.urlcode,'historic123');assert.equal(sent.data.url,'LINK:historic123');});
test('frontend sends investor and selected document code together',async()=>{let query;const ops=load('frontend/src/services/operations.js',{'./api':{request:async(p,q)=>{query=q;return {results:[{ok:true,channel:'SMS'}]}}}},true,{window:{location:{origin:'http://ui'}}});await ops.sendNotification({notify:'/notify/trade-confirmation'},{investorCode:'0015',url:'http://api/report/pdf?BOID=historic123'},'mobile');assert.equal(query.urlcode,'historic123');assert.equal(query.code,'0015');});
test('distinct historical documents for one investor are not collapsed',()=>{const ops=load('frontend/src/services/operations.js',{'./api':{}},true);assert.equal(ops.uniqueTargets([{investorCode:'0015',url:'a'},{investorCode:'0015',url:'b'},{investorCode:'0015',url:'a'}]).length,2);});
test('leaving bulk page stops future sends and avoids detached UI updates',async()=>{let release,sends=0,detachedWrites=0,detached=false;const cleanup=[];const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:value=>({current:value}),useState:value=>[value,()=>{if(detached)detachedWrites++}],useEffect:fn=>cleanup.push(fn())};const set=()=>{if(detached)detachedWrites++};const component=load('frontend/src/components/ActionToolbar.jsx',{'react':React,'../services/api':{request:async()=>({}),csvDownload(){}},'../services/operations':{uniqueTargets:rows=>rows,validSchedule:v=>v,sendNotification:async()=>{sends++;return new Promise(r=>release=r)}}},true,{window:{confirm:()=>true}}).default;
 const tree=component({module:{name:'Trade',type:'TRADE_CONFIRMATION',slug:'trade',prefix:'/report',notify:'/notify/trade',scheduleId:2},routes:[{method:'GET',path:'/api/notify/trade'}],rows:[{investorCode:'1',url:'a'},{investorCode:'2',url:'b'}],busy:false,setBusy:set,setError:set,setMessage:set,operationLock:{current:false},reload:async()=>{}});
 function find(node){if(!node||typeof node!=='object')return; if(node.type==='button'&&node.props.children.includes('Send all email'))return node;for(const child of node.props?.children.flat(Infinity)||[]){const found=find(child);if(found)return found;}}
 const promise=find(tree).props.onClick();assert.equal(sends,1);detached=true;for(const fn of cleanup)fn?.();release('EMAIL');await promise;assert.equal(sends,1);assert.equal(detachedWrites,0);
});

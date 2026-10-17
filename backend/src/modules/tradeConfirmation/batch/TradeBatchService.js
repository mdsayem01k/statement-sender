const crypto = require('crypto');
const { HttpError } = require('../../../core/errors');
const SmsChannel = require('../../../channels/SmsChannel');
const EmailChannel = require('../../../channels/EmailChannel');
const { toIntl } = require('../../../utils/phone');
const TradeBatchRepository = require('./TradeBatchRepository');

class TradeBatchService {
  constructor(module, repository = new TradeBatchRepository(), channels = null) {
    this.module=module;
    this.repository=repository;
    this.active=new Map();
    const timeout=Number(process.env.TRADE_BATCH_TIMEOUT_MS || 30000);
    const lease=Number(process.env.TRADE_BATCH_LEASE_SECONDS || 180);
    if(!Number.isFinite(timeout)||timeout<1000||timeout>120000) throw new Error('TRADE_BATCH_TIMEOUT_MS must be 1000..120000');
    if(!Number.isInteger(lease)||lease<Math.ceil(timeout/1000)+90) throw new Error('TRADE_BATCH_LEASE_SECONDS must exceed timeout by at least 90 seconds');
    this.leaseSeconds=lease;
    this.channels=channels || {
      MOBILE:new SmsChannel({...module.ctx.env.sms,timeoutMs:timeout}),
      EMAIL:new EmailChannel({...module.ctx.env.mail,timeoutMs:timeout})
    };
  }

  normalize(targets,via) {
    if(!['mobile','email','all'].includes(via)) throw new HttpError(400,'via must be mobile, email or all');
    if(!Array.isArray(targets)||targets.length<1||targets.length>2000) throw new HttpError(400,'Select 1..2000 report rows');
    const unique=new Map();
    for(const row of targets) {
      const code=String(row.code||'').trim();
      const urlcode=String(row.urlcode||'').trim();
      if(!code||code.length>50||!/^[A-Za-z0-9_-]{6,128}$/.test(urlcode)) throw new HttpError(400,'Invalid investor/document selection');
      unique.set(JSON.stringify([code,urlcode]),{code,urlcode});
    }
    const rows=[...unique.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(['TRADE_CONFIRMATION',via,rows])).digest('hex');
    return {rows,fingerprint};
  }

  async create(targets,via) {
    const {rows,fingerprint}=this.normalize(targets,via);
    const existing=await this.repository.findFingerprint(fingerprint);
    if(existing) return this.status(existing);
    const items=[];
    const mc=this.module.ctx.messageCenter;
    for(const target of rows) {
      const contact=await this.module.repository.findContactByCode(target.code,target.urlcode);
      if(!contact) throw new HttpError(404,`Document mapping not found for ${target.code}`);
      const data={investor:contact.investor,url:this.module.link(target.urlcode)};
      for(const channel of via==='all'?['MOBILE','EMAIL']:[via==='mobile'?'MOBILE':'EMAIL']) {
        const raw=channel==='MOBILE'?(mc.testMobile||contact.mobile):(mc.testEmail||contact.email);
        const first=String(raw||'').split(',')[0].trim();
        const recipient=channel==='MOBILE'?(toIntl(first)||first):first;
        if(recipient.length>254)throw new HttpError(400,`Recipient address is too long for ${target.code}`);
        if(this.channels[channel]?.config && !this.channels[channel].config.baseUrl)throw new HttpError(503,`${channel} gateway is not configured`);
        items.push({
          InvestorCode:target.code,UrlCode:target.urlcode,Via:channel,Recipient:recipient,
          MessageText:mc.render('TRADE_CONFIRMATION',data,'text'),
          Subject:channel==='EMAIL'?mc.render('TRADE_CONFIRMATION',data,'subject'):null,
          Html:channel==='EMAIL'?mc.render('TRADE_CONFIRMATION',data,'html'):null
        });
      }
    }
    const id=await this.repository.create(fingerprint,via,items);
    return this.status(id);
  }

  async status(id) {
    const status=await this.repository.status(id);
    if(!status) throw new HttpError(404,'Batch not found');
    return status;
  }

  async resume(id) {
    await this.status(id);
    const owner=crypto.randomUUID();
    if(await this.repository.acquire(id,owner,this.leaseSeconds)) {
      const task=this.run(id,owner).finally(()=>this.active.delete(String(id)));
      this.active.set(String(id),task);
    }
    return this.status(id);
  }

  async run(id,owner) {
    try {
      for(;;) {
        const item=await this.repository.claimNext(id,owner,this.leaseSeconds);
        if(!item) break;
        const channel=this.channels[item.Via];
        const recipient=item.Via==='MOBILE'?{mobile:item.Recipient}:{email:item.Recipient};
        let state,result=null,error=null;
        if(!channel || !channel.accepts(recipient)) {
          state='FAILED';error='Invalid or missing snapshotted recipient';
        } else {
          try {
            result=await channel.send({type:'TRADE_CONFIRMATION',recipient,text:item.MessageText,subject:item.Subject,html:item.Html});
            if(result==null || result?.success===false) { state='UNKNOWN';error='Provider returned a failure response; verify before retrying'; }
            else state='ACCEPTED';
          } catch(e) {
            state=e.errorType==='SMS_DAILY_LIMIT'||e.definitelyNotSent===true?'FAILED':'UNKNOWN';
            error=e.message;
          }
        }
        await this.repository.record(item,owner,state,result,error);
        await this.module.ctx.audit.save({
          encryptoCode:item.UrlCode,resolvedCode:item.InvestorCode,recipientRole:'INVESTOR',
          status:state==='ACCEPTED'?`TRADE_CONFIRMATION_${item.Via==='MOBILE'?'SMS':'EMAIL'}_SENT`:`TRADE_CONFIRMATION_${state}`,
          statusCode:state==='ACCEPTED'?200:state==='FAILED'?422:504,
          errorMessage:error?`Batch ${id}: ${error}`:null
        });
      }
      await this.repository.finish(id,owner);
    } catch(error) {
      console.error(`[TRADE BATCH ${id}] stopped; resume/reconcile after lease recovery:`,error.message);
      try{await this.repository.noteError(id,owner,error.message);}catch{}
    }
  }

  async reconcile(id,item,outcome,note,reference) {
    await this.status(id);
    if(!['accepted','not_sent'].includes(outcome)||typeof note!=='string'||!note.trim()||note.length>1000) {
      throw new HttpError(400,'Provide accepted/not_sent and a provider-verification note (1..1000 characters)');
    }
    if(!/^\d+$/.test(String(item))||String(item).length>18) throw new HttpError(400,'Invalid item ID');
    if(reference!=null && (typeof reference!=='string'||reference.length>255)) throw new HttpError(400,'Invalid provider reference');
    if(!await this.repository.reconcile(id,item,outcome,note.trim(),reference)) throw new HttpError(409,'Only UNKNOWN items can be reconciled');
    return this.status(id);
  }

  routes() {
    const id=req=>{
      const value=req.params.id;
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new HttpError(400,'Invalid batch ID');
      return value;
    };
    const base='/report/send-batches';
    return [
      {method:'get',path:base,handler:async(req,res)=>res.json({success:true,data:await this.repository.list()})},
      {method:'post',path:base,handler:async(req,res)=>res.status(201).json({success:true,data:await this.create(req.body?.targets,req.body?.via)})},
      {method:'get',path:`${base}/:id`,handler:async(req,res)=>res.json({success:true,data:await this.status(id(req))})},
      {method:'post',path:`${base}/:id/resume`,handler:async(req,res)=>res.status(202).json({success:true,data:await this.resume(id(req))})},
      {method:'post',path:`${base}/:id/retry-failed`,handler:async(req,res)=>{const value=id(req);const current=await this.status(value);if(current.State==='RUNNING')throw new HttpError(409,'Pause the batch before retrying rejected items');await this.repository.retryFailed(value);res.json({success:true,data:await this.status(value)});}},
      {method:'post',path:`${base}/:id/pause`,handler:async(req,res)=>{const value=id(req);await this.status(value);await this.repository.pause(value);res.json({success:true,data:await this.status(value)});}},
      {method:'post',path:`${base}/:id/items/:item/reconcile`,handler:async(req,res)=>res.json({success:true,data:await this.reconcile(id(req),req.params.item,req.body?.outcome,req.body?.note,req.body?.providerReference)})}
    ];
  }
}
module.exports=TradeBatchService;

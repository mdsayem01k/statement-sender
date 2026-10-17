const Db = require('../../../core/Db');
const crypto = require('crypto');

class TradeBatchRepository {
  async query(bind, query) {
    const pool = await Db.pool();
    const request = pool.request();
    bind(request, Db.sql);
    return request.query(query);
  }

  async findFingerprint(fingerprint) {
    const r = await this.query((q,s) => q.input('fingerprint',s.VarChar(64),fingerprint),
      'SELECT BatchID FROM dbo.TradeSendBatch WHERE Fingerprint=@fingerprint');
    return r.recordset[0]?.BatchID || null;
  }

  async create(fingerprint, via, items) {
    const id = crypto.randomUUID();
    const r = await this.query((q,s) => q.input('id',s.UniqueIdentifier,id).input('fingerprint',s.VarChar(64),fingerprint)
      .input('via',s.VarChar(10),via).input('items',s.NVarChar(s.MAX),JSON.stringify(items)), `
      SET NOCOUNT ON; SET XACT_ABORT ON;
      BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @resource NVARCHAR(255)=CONCAT('TRADE_BATCH_CREATE:',@fingerprint), @lock INT, @existing UNIQUEIDENTIFIER;
        EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
        IF @lock<0 THROW 50011,'Cannot acquire batch creation lock.',1;
        SELECT @existing=BatchID FROM dbo.TradeSendBatch WHERE Fingerprint=@fingerprint;
        IF @existing IS NULL
        BEGIN
          INSERT dbo.TradeSendBatch(BatchID,Fingerprint,Via) VALUES(@id,@fingerprint,@via);
          INSERT dbo.TradeSendItem(BatchID,InvestorCode,UrlCode,Via,Recipient,MessageText,Subject,Html)
          SELECT @id,InvestorCode,UrlCode,Via,Recipient,MessageText,Subject,Html
          FROM OPENJSON(@items) WITH (
            InvestorCode VARCHAR(50),UrlCode VARCHAR(128),Via VARCHAR(10),Recipient NVARCHAR(254),
            MessageText NVARCHAR(MAX),Subject NVARCHAR(500),Html NVARCHAR(MAX)
          );
          SET @existing=@id;
        END;
        COMMIT TRANSACTION;
        SELECT @existing AS BatchID;
      END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
    `);
    return r.recordset[0].BatchID;
  }

  async recover(id) {
    await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id), `
      SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
      IF EXISTS(SELECT 1 FROM dbo.TradeSendBatch WITH(UPDLOCK,HOLDLOCK) WHERE BatchID=@id AND State='RUNNING' AND LeaseUntil<=SYSUTCDATETIME())
      BEGIN
        UPDATE dbo.TradeSendItem SET State='UNKNOWN',Error='Worker lease expired; verify provider outcome before retrying.',UpdatedAt=SYSUTCDATETIME()
          WHERE BatchID=@id AND State='PROCESSING';
        UPDATE dbo.TradeSendBatch SET State='PAUSED',Owner=NULL,LeaseUntil=NULL,UpdatedAt=SYSUTCDATETIME() WHERE BatchID=@id;
      END;
      COMMIT TRANSACTION; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
    `);
  }

  async acquire(id, owner, seconds) {
    await this.recover(id);
    const r=await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id).input('owner',s.UniqueIdentifier,owner).input('seconds',s.Int,seconds), `
      UPDATE dbo.TradeSendBatch WITH(UPDLOCK)
      SET State='RUNNING',Owner=@owner,LeaseUntil=DATEADD(SECOND,@seconds,SYSUTCDATETIME()),PauseRequested=0,Error=NULL,UpdatedAt=SYSUTCDATETIME()
      WHERE BatchID=@id AND State<>'RUNNING';
      SELECT @@ROWCOUNT AS changed;
    `);
    return r.recordset[0].changed===1;
  }

  async claimNext(id,owner,seconds) {
    const r=await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id).input('owner',s.UniqueIdentifier,owner).input('seconds',s.Int,seconds), `
      SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
      UPDATE dbo.TradeSendBatch WITH(UPDLOCK)
      SET LeaseUntil=DATEADD(SECOND,@seconds,SYSUTCDATETIME()),UpdatedAt=SYSUTCDATETIME()
      WHERE BatchID=@id AND Owner=@owner AND State='RUNNING' AND LeaseUntil>SYSUTCDATETIME() AND PauseRequested=0;
      IF @@ROWCOUNT=0
      BEGIN COMMIT TRANSACTION; SELECT CAST(1 AS BIT) AS Stop; END
      ELSE
      BEGIN
        ;WITH nextItem AS (
          SELECT TOP 1 * FROM dbo.TradeSendItem WITH(UPDLOCK,ROWLOCK)
          WHERE BatchID=@id AND State='PENDING' ORDER BY ItemID
        )
        UPDATE nextItem SET State='PROCESSING',Owner=@owner,AttemptCount=AttemptCount+1,UpdatedAt=SYSUTCDATETIME()
        OUTPUT inserted.*;
        COMMIT TRANSACTION;
      END;
      END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
    `);
    const row=r.recordset?.[0];
    return !row || row.Stop ? null : row;
  }

  async record(item,owner,state,result=null,error=null) {
    const reference=result?.messageId ?? result?.message_id ?? null;
    const r=await this.query((q,s)=>q.input('item',s.BigInt,String(item.ItemID)).input('owner',s.UniqueIdentifier,owner)
      .input('state',s.VarChar(16),state).input('response',s.NVarChar(s.MAX),result==null?null:JSON.stringify(result))
      .input('reference',s.NVarChar(255),reference==null?null:String(reference).slice(0,255))
      .input('error',s.NVarChar(1000),error?String(error).slice(0,1000):null), `
      UPDATE dbo.TradeSendItem SET State=@state,ProviderResponse=@response,ProviderReference=@reference,Error=@error,UpdatedAt=SYSUTCDATETIME()
      WHERE ItemID=@item AND Owner=@owner AND State='PROCESSING';
      SELECT @@ROWCOUNT AS changed;
    `);
    if(r.recordset[0].changed!==1) throw new Error('Batch item ownership/state changed; outcome needs review');
  }

  async finish(id,owner) {
    await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id).input('owner',s.UniqueIdentifier,owner), `
      UPDATE dbo.TradeSendBatch SET State=CASE WHEN EXISTS(
        SELECT 1 FROM dbo.TradeSendItem WHERE BatchID=@id AND State<>'ACCEPTED'
      ) THEN 'PAUSED' ELSE 'COMPLETED' END,Owner=NULL,LeaseUntil=NULL,UpdatedAt=SYSUTCDATETIME()
      WHERE BatchID=@id AND Owner=@owner AND NOT EXISTS(
        SELECT 1 FROM dbo.TradeSendItem WHERE BatchID=@id AND State='PROCESSING'
      );
    `);
  }

  async noteError(id,owner,error) {
    await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id).input('owner',s.UniqueIdentifier,owner).input('error',s.NVarChar(1000),String(error).slice(0,1000)),
      'UPDATE dbo.TradeSendBatch SET Error=@error,UpdatedAt=SYSUTCDATETIME() WHERE BatchID=@id AND Owner=@owner');
  }

  async pause(id) {
    await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id),
      'UPDATE dbo.TradeSendBatch SET PauseRequested=1,UpdatedAt=SYSUTCDATETIME() WHERE BatchID=@id');
  }

  async status(id) {
    await this.recover(id);
    const r=await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id), `
      SELECT b.*,COUNT(i.ItemID) AS Total,
        SUM(CASE WHEN i.State='PENDING' THEN 1 ELSE 0 END) AS Pending,
        SUM(CASE WHEN i.State='PROCESSING' THEN 1 ELSE 0 END) AS Processing,
        SUM(CASE WHEN i.State='ACCEPTED' THEN 1 ELSE 0 END) AS Accepted,
        SUM(CASE WHEN i.State='FAILED' THEN 1 ELSE 0 END) AS Failed,
        SUM(CASE WHEN i.State='UNKNOWN' THEN 1 ELSE 0 END) AS Unknown
      FROM dbo.TradeSendBatch b LEFT JOIN dbo.TradeSendItem i ON i.BatchID=b.BatchID
      WHERE b.BatchID=@id GROUP BY b.BatchID,b.Fingerprint,b.Via,b.State,b.Owner,b.LeaseUntil,b.PauseRequested,b.CreatedAt,b.UpdatedAt,b.Error;
      SELECT ItemID,InvestorCode,UrlCode,Via,Recipient,State,AttemptCount,ProviderReference,Error,ReconcileNote,UpdatedAt
      FROM dbo.TradeSendItem WHERE BatchID=@id ORDER BY ItemID;
    `);
    return r.recordsets[0][0] ? {...r.recordsets[0][0],items:r.recordsets[1]} : null;
  }

  async list() {
    const r=await this.query(()=>{}, 'SELECT TOP 20 BatchID,Via,State,CreatedAt,LeaseUntil FROM dbo.TradeSendBatch ORDER BY CreatedAt DESC');
    return r.recordset;
  }

  async retryFailed(id) {
    await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id), `
      SET XACT_ABORT ON; BEGIN TRY BEGIN TRANSACTION;
      IF EXISTS(SELECT 1 FROM dbo.TradeSendBatch WITH(UPDLOCK,HOLDLOCK) WHERE BatchID=@id AND State<>'RUNNING')
        UPDATE dbo.TradeSendItem SET State='PENDING',Owner=NULL,Error=NULL,UpdatedAt=SYSUTCDATETIME()
        WHERE BatchID=@id AND State='FAILED';
      COMMIT TRANSACTION; END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; THROW; END CATCH;
    `);
  }

  async reconcile(id,item,outcome,note,reference) {
    const state=outcome==='accepted'?'ACCEPTED':'PENDING';
    const r=await this.query((q,s)=>q.input('id',s.UniqueIdentifier,id).input('item',s.BigInt,String(item))
      .input('state',s.VarChar(16),state).input('note',s.NVarChar(1000),note)
      .input('reference',s.NVarChar(255),reference||null), `
      UPDATE dbo.TradeSendItem SET State=@state,ReconcileNote=@note,ProviderReference=COALESCE(@reference,ProviderReference),Error=NULL,Owner=NULL,UpdatedAt=SYSUTCDATETIME()
      WHERE BatchID=@id AND ItemID=@item AND State='UNKNOWN';
      DECLARE @changed INT=@@ROWCOUNT;
      IF @changed=1 AND @state='ACCEPTED'
        UPDATE dbo.TradeSendBatch SET State='COMPLETED',UpdatedAt=SYSUTCDATETIME()
        WHERE BatchID=@id AND State='PAUSED' AND NOT EXISTS(SELECT 1 FROM dbo.TradeSendItem WHERE BatchID=@id AND State<>'ACCEPTED');
      SELECT @changed AS changed;
    `);
    return r.recordset[0].changed===1;
  }
}
module.exports=TradeBatchRepository;

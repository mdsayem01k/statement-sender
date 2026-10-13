const crypto = require('crypto');
const Db = require('../core/Db');

class DeliveryLedger {
  constructor({ poolName = 'poolPromise', module }) {
    this.poolName = poolName;
    this.module = module;
  }

  key(id, role, via) {
    return crypto.createHash('sha256')
      .update(JSON.stringify([this.module, String(id), role, via]))
      .digest('hex');
  }

  async claim(id, role, via) {
    const { sql } = Db;
    const pool = await Db.pool(this.poolName);
    const key = this.key(id, role, via);
    const owner = crypto.randomUUID();
    const result = await pool.request()
      .input('key', sql.VarChar(64), key)
      .input('module', sql.NVarChar(160), this.module)
      .input('id', sql.NVarChar(100), String(id))
      .input('role', sql.NVarChar(20), role)
      .input('via', sql.NVarChar(10), via)
      .input('owner', sql.UniqueIdentifier, owner)
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          DECLARE @resource NVARCHAR(255) = CONCAT('NOTIFICATION_DELIVERY:', @key);
          DECLARE @lockResult INT;
          EXEC @lockResult = sys.sp_getapplock
            @Resource = @resource,
            @LockMode = 'Exclusive',
            @LockOwner = 'Transaction',
            @LockTimeout = 10000;
          IF @lockResult < 0 THROW 50004, 'Unable to acquire delivery lock.', 1;
          UPDATE dbo.NotificationDelivery
          SET State = 'UNKNOWN', Error = 'Delivery worker expired; reconcile before retrying.', UpdatedAt = SYSUTCDATETIME()
          WHERE DeliveryKey = @key AND State = 'IN_FLIGHT' AND LeaseUntil <= SYSUTCDATETIME();
          DECLARE @state VARCHAR(16), @channel NVARCHAR(20), @allowed BIT = 0;
          SELECT @state = State, @channel = Channel
          FROM dbo.NotificationDelivery WHERE DeliveryKey = @key;
          IF @state IS NULL
          BEGIN
            INSERT INTO dbo.NotificationDelivery
              (DeliveryKey, Module, NotificationID, RecipientRole, Via, State, Owner, LeaseUntil)
            VALUES
              (@key, @module, @id, @role, @via, 'IN_FLIGHT', @owner, DATEADD(MINUTE, 30, SYSUTCDATETIME()));
            SET @allowed = 1;
            SET @state = 'IN_FLIGHT';
          END
          ELSE IF @state = 'FAILED'
          BEGIN
            UPDATE dbo.NotificationDelivery
            SET State = 'IN_FLIGHT', Owner = @owner, Channel = NULL, Error = NULL,
                LeaseUntil = DATEADD(MINUTE, 30, SYSUTCDATETIME()), UpdatedAt = SYSUTCDATETIME()
            WHERE DeliveryKey = @key;
            SET @allowed = 1;
            SET @state = 'IN_FLIGHT';
          END;
          COMMIT TRANSACTION;
          SELECT @allowed AS allowed, @state AS state, @channel AS channel;
        END TRY
        BEGIN CATCH
          IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;
      `);
    const row = result.recordset?.[0];
    if (!row) throw new Error('Delivery claim returned no result');
    return { key, owner, ...row };
  }

  async record(claim, state, channel = null, error = null) {
    const { sql } = Db;
    const pool = await Db.pool(this.poolName);
    const result = await pool.request()
      .input('key', sql.VarChar(64), claim.key)
      .input('owner', sql.UniqueIdentifier, claim.owner)
      .input('state', sql.VarChar(16), state)
      .input('channel', sql.NVarChar(20), channel)
      .input('error', sql.NVarChar(1000), error ? String(error).slice(0, 1000) : null)
      .query(`
        UPDATE dbo.NotificationDelivery
        SET State = @state, Channel = COALESCE(@channel, Channel), Error = @error, UpdatedAt = SYSUTCDATETIME()
        WHERE DeliveryKey = @key AND Owner = @owner AND State IN ('IN_FLIGHT', 'ACCEPTED');
        SELECT @@ROWCOUNT AS changed;
      `);
    if (result.recordset?.[0]?.changed !== 1) throw new Error('Delivery claim ownership or state changed');
  }
}

module.exports = DeliveryLedger;

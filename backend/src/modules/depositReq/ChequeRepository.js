const Db = require('../../core/Db');
const ReceiptRepository = require('../receipt/ReceiptRepository');
const RmRepository = require('../rm/RmRepository');

const norm = (v) => String(v ?? '').trim().toUpperCase();

class ChequeRepository extends ReceiptRepository {
  constructor(settings = {}) {
    super({
      syncTable: 'dbo.DepositReq_sync',
      notificationTable: 'dbo.depositReqNotification',
      idColumn: 'ChequeID',
      sourcePool: 'BOpoolPromise',
    });
    this.rmRepo = new RmRepository();
    this.settings = settings;
    this.sinceColumn = 's.SourceInTimestamp';

    this.select += `
      , rm.Whatsapp_group AS RmWhatsappGroup
    `;

    this.join += `
      OUTER APPLY (
        SELECT
          MIN(
            NULLIF(
              LTRIM(RTRIM(r.Whatsapp_group)),
              ''
            )
          ) AS Whatsapp_group
        FROM dbo.rm_info r
        WHERE r.tradercode = s.Trader
        HAVING COUNT(
          DISTINCT NULLIF(
            LTRIM(RTRIM(r.Whatsapp_group)),
            ''
          )
        ) <= 1
      ) rm
    `;
  }


  async fetchNewFromSource(afterId) {
    const { sql } = Db;
    const p = await Db.pool(this.sourcePool);
    const r = await p.request()
      .input('last', sql.Int, afterId)
      .input('since', sql.VarChar(19), this.settings.syncSince)
      .query(`
SELECT d.RecordID AS ChequeID,
       d.InvestorID, d.InvestorCode, d.InvestorName,
       d.ReceiveDate, d.Amount,
       'BO PORTAL' AS Descriptions,
       NULL AS ReferenceNumber,
       d.InTimeStamp AS SourceInTimestamp
FROM dbo.Payments_tblDepositRequisition d
WHERE d.RecordID > @last
  AND d.InTimeStamp >= CONVERT(DATETIME2, @since, 126)
ORDER BY d.RecordID`);

    const enriched = await this.attachInvestorInfo(r.recordset);
    return this.rmRepo.attach(enriched);
  }

  async attachInvestorInfo(rows) {
    const empty = { CellNo: null, Email: null, Trader: null };
    const codes = [...new Set(rows.map((x) => x.InvestorCode).filter(Boolean))];
    if (!codes.length) return rows.map((x) => ({ ...x, ...empty }));

    const p = await Db.pool('XBpoolPromise');
    const map = new Map();
    for (let i = 0; i < codes.length; i += 500) {
      const req = p.request();
      const names = codes.slice(i, i + 500).map((c, j) => {
        req.input(`c${j}`, Db.sql.NVarChar(50), c);
        return `@c${j}`;
      });
      const { recordset } = await req.query(
        `SELECT i.InvestorCode, i.CellNo, i.Email, t.UserID AS Trader
         FROM dbo.Setup_tblInvestor i
         LEFT JOIN dbo.Trade_tblTraderList t ON t.TRADERID = i.TraderID
         WHERE i.InvestorCode IN (${names.join(',')})`);
      recordset.forEach((x) => map.set(norm(x.InvestorCode), x));
    }
    return rows.map((x) => {
      const info = map.get(norm(x.InvestorCode));
      return {
        ...x,
        CellNo: info?.CellNo || null,
        Email: info?.Email || null,
        Trader: info?.Trader || null,
      };
    });
  }

  async findUnsent({
    limit,
    maxRetry,
    deliveryModule
  }) {
    const { sql } = Db;
    const pool = await this.pool();
    const c = this.settings;

    const result = await pool.request()
      .input('limit', sql.Int, limit)
      .input('retry', sql.Int, maxRetry)
      .input('since', sql.DateTime, c.notifySince)
      .input(
        'groupSince',
        sql.DateTime,
        c.groupSince
      )
      .input(
        'rmGroupSince',
        sql.DateTime,
        c.rmGroupSince
      )
      .input(
        'module',
        sql.NVarChar(160),
        deliveryModule
      )
      .input(
        'recipientModule',
        sql.NVarChar(60),
        this.bare
      )
      .input('mobile', sql.Bit, c.mobileEnabled)
      .input('email', sql.Bit, c.emailEnabled)
      .input('rmGroup', sql.Bit, c.rmGroupEnabled && !c.testGroup)
      .input('group', sql.Bit, c.groupEnabled && !c.testGroup)
      .input('demo', sql.Bit, Boolean(c.testGroup) && (c.rmGroupEnabled || c.groupEnabled))
      .input('demoSince', sql.DateTime, new Date(Math.min(
        ...(c.rmGroupEnabled ? [c.rmGroupSince.getTime()] : []),
        ...(c.groupEnabled ? [c.groupSince.getTime()] : []),
        ...(!c.rmGroupEnabled && !c.groupEnabled ? [c.notifySince.getTime()] : [])
      )))
      .query(`
        UPDATE dbo.NotificationDelivery
        SET
          State = 'UNKNOWN',
          Error =
            'Deposit Requisition worker expired; reconcile before retrying.',
          UpdatedAt = SYSUTCDATETIME()
        WHERE Module = @module
          AND State = 'IN_FLIGHT'
          AND LeaseUntil <= SYSUTCDATETIME();

        SELECT TOP (@limit)
          ${this.columns()}
        FROM ${this.table} n
        ${this.join}
        WHERE n.UrlCode IS NOT NULL
          AND s.SourceInTimestamp >= @since
          AND EXISTS (
            SELECT 1
            FROM (
              VALUES
                ('INVESTOR', 'MOBILE'),
                ('INVESTOR', 'EMAIL'),
                ('RM_GROUP', 'GROUP'),
                ('FINACC', 'GROUP'),
                ('DEMO_GROUP', 'GROUP')
            ) v(Role, Via)
            WHERE (
              (v.Role = 'DEMO_GROUP' AND v.Via = 'GROUP'
                AND @demo = 1 AND s.SourceInTimestamp >= @demoSince)
              OR
              (
                v.Role = 'INVESTOR'
                AND v.Via = 'MOBILE'
                AND @mobile = 1
                AND ISNULL(n.CellNo, '') <> ''
              )
              OR (
                v.Role = 'INVESTOR'
                AND v.Via = 'EMAIL'
                AND @email = 1
                AND ISNULL(n.Email, '') <> ''
              )
              OR (
                v.Role = 'RM_GROUP'
                AND v.Via = 'GROUP'
                AND @rmGroup = 1
                AND s.SourceInTimestamp >= @rmGroupSince
                AND NULLIF(
                  LTRIM(RTRIM(rm.Whatsapp_group)),
                  ''
                ) IS NOT NULL
              )
              OR (
                v.Role = 'FINACC'
                AND v.Via = 'GROUP'
                AND @group = 1
                AND s.SourceInTimestamp >= @groupSince
              )
            )
            AND (
              (
                v.Role = 'INVESTOR'
                AND n.RetryCount < @retry
                AND (
                  (
                    v.Via = 'MOBILE'
                    AND n.IsSentSms = 0
                  )
                  OR (
                    v.Via = 'EMAIL'
                    AND n.IsSentEmail = 0
                  )
                )
              )
              OR (
                v.Role <> 'INVESTOR'
                AND NOT EXISTS (
                  SELECT 1
                  FROM dbo.NotificationRecipient r
                  WHERE r.Module = @recipientModule
                    AND r.NotificationID = n.${this.pk}
                    AND r.Role = v.Role
                    AND r.Channel = v.Via
                    AND (
                      r.IsSent = 1
                      OR r.RetryCount >= @retry
                    )
                )
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM dbo.NotificationDelivery d
              WHERE d.Module = @module
                AND d.NotificationID =
                  CONVERT(NVARCHAR(100), n.${this.pk})
                AND d.RecipientRole = v.Role
                AND d.Via = v.Via
                AND d.State IN (
                  'IN_FLIGHT',
                  'UNKNOWN',
                  'SENT'
                )
            )
          )
        ORDER BY n.${this.pk};
      `);

    return result.recordset;
  }
}

module.exports = ChequeRepository;

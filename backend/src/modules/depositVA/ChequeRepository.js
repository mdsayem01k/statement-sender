const Db = require('../../core/Db');
const ReceiptRepository = require('../receipt/ReceiptRepository');
const RmRepository = require('../rm/RmRepository');

class ChequeRepository extends ReceiptRepository {
  constructor(settings = {}) {
    super({
      syncTable: 'dbo.ChequePayments_Sync',
      notificationTable: 'dbo.ChequeNotification',
      idColumn: 'ChequeID',
      sourcePool: 'XBpoolPromise'
    });

    this.rm = new RmRepository();
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
    const pool = await Db.pool(this.sourcePool);

    const result = await pool.request()
      .input('last', sql.Int, afterId)
      .input(
        'since',
        sql.VarChar(19),
        this.settings.syncSince
      )
      .query(`
        SELECT
          p.ChequeID,
          p.investorID AS InvestorID,
          i.InvestorCode,
          i.CellNo,
          i.Email,
          t.USERID AS Trader,
          p.ReceiveDate,
          p.amount AS Amount,
          p.Descriptions,
          p.ReferenceNumber,
          p.inTimestamp AS SourceInTimestamp
        FROM Payments_tblChequePayments p
        LEFT JOIN Setup_tblInvestor i
          ON i.investorID = p.investorID
        LEFT JOIN dbo.Trade_tblTraderList t
          ON t.TRADERID = i.TraderID
        WHERE p.VoucherNo_Prefix LIKE '%API%'
          AND p.ChequeID > @last
          AND p.inTimestamp >=
            CONVERT(DATETIME2, @since, 126)
        ORDER BY p.ChequeID;
      `);

    return this.rm.attach(result.recordset);
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
      .input('rmGroup', sql.Bit, c.rmGroupEnabled)
      .input('group', sql.Bit, c.groupEnabled)
      .query(`
        UPDATE dbo.NotificationDelivery
        SET
          State = 'UNKNOWN',
          Error =
            'Deposit VA worker expired; reconcile before retrying.',
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
                ('FINACC', 'GROUP')
            ) v(Role, Via)
            WHERE (
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
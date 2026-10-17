const Db = require('../../core/Db');
const NotificationRepository = require('../../core/NotificationRepository');

const first = value =>
  String(value || '').split(',')[0].trim();

const normalize = value =>
  String(value || '').trim().toLowerCase();

const recordKey = (investorCode, boNumber) =>
  JSON.stringify([
    normalize(investorCode),
    String(boNumber || '').trim()
  ]);

class CityAgentRepository extends NotificationRepository {
  constructor(settings = {}) {
    super({
      table: 'dbo.CityAgentNotification',
      pk: 'NotificationID'
    });

    this.settings = settings;
  }

  ddl() {
    return `
      IF OBJECT_ID('dbo.CityAgentNotification', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.CityAgentNotification (
          NotificationID INT IDENTITY(1,1) PRIMARY KEY,
          BORegistrationMasterID INT NULL,
          InvestorCode NVARCHAR(50) NOT NULL,
          BoNumber NVARCHAR(50) NOT NULL,
          AgentRefCode NVARCHAR(100) NOT NULL,
          SourceInTimestamp DATETIME NULL,
          InsertDate DATETIME NOT NULL DEFAULT GETDATE(),
          UpdatedAt DATETIME NULL,
          UrlCode NVARCHAR(64) NULL,
          CellNo NVARCHAR(30) NULL,
          Email NVARCHAR(150) NULL,
          IsSentSms BIT NOT NULL DEFAULT 0,
          IsSentEmail BIT NOT NULL DEFAULT 0,
          SmsSentAt DATETIME NULL,
          EmailSentAt DATETIME NULL,
          SmsError NVARCHAR(300) NULL,
          EmailError NVARCHAR(300) NULL,
          RetryCount INT NOT NULL DEFAULT 0,
          CONSTRAINT UQ_CityAgent_InvestorBo
            UNIQUE (InvestorCode, BoNumber)
        );
      END;

      IF COL_LENGTH(
        'dbo.CityAgentNotification',
        'BORegistrationMasterID'
      ) IS NULL
      BEGIN
        ALTER TABLE dbo.CityAgentNotification
        ADD BORegistrationMasterID INT NULL;
      END;
    `;
  }

  async fetchCandidates() {
    const boPool = await Db.pool('BOpoolPromise');

    const sourceDate = this.settings.sourceDate
      ? `ma.${this.settings.sourceDate}`
      : 'NULL';

    const { recordset } = await boPool.request().query(`
      SELECT
        ma.BORegistrationMasterID,
        ma.CustomCode AS InvestorCode,
        inv.ReferBO AS AgentRefCode,
        ${sourceDate} AS SourceInTimestamp
      FROM dbo.Investor_tblBOInvestorBOOpen inv
      JOIN dbo.Investor_tblBORegistrationMaster ma
        ON inv.BORegistrationMasterID =
           ma.BORegistrationMasterID
      WHERE inv.isReferBO = '1'
        AND NULLIF(
          LTRIM(RTRIM(ma.CustomCode)),
          ''
        ) IS NOT NULL;
    `);

    const sourceRows = new Map();

    for (const source of recordset) {
      const investorCode = String(
        source.InvestorCode || ''
      ).trim();

      if (!investorCode) {
        continue;
      }

      const agentRefCode = String(
        source.AgentRefCode || ''
      ).trim();

      const key = normalize(investorCode);
      const existing = sourceRows.get(key);

      if (
        existing &&
        normalize(existing.AgentRefCode) !==
          normalize(agentRefCode)
      ) {
        throw new Error(
          `Conflicting CityAgent references for ${investorCode}`
        );
      }

      sourceRows.set(key, {
        ...source,
        InvestorCode: investorCode,
        AgentRefCode: agentRefCode
      });
    }

    if (!sourceRows.size) {
      return [];
    }

    const xbPool = await Db.pool('XBpoolPromise');

    const investorCodes = [...sourceRows.values()].map(
      row => row.InvestorCode
    );

    const matchedRows = new Map();

    for (
      let index = 0;
      index < investorCodes.length;
      index += 500
    ) {
      const request = xbPool.request();

      const parameters = investorCodes
        .slice(index, index + 500)
        .map((code, position) => {
          request.input(
            `c${position}`,
            Db.sql.NVarChar(50),
            code
          );

          return `@c${position}`;
        });

      const matches = await request.query(`
        SELECT
          InvestorCode,
          boid AS BoNumber
        FROM dbo.Setup_tblInvestor
        WHERE InvestorCode IN (
          ${parameters.join(',')}
        )
          AND boid LIKE '1204500%'
          AND LEN(boid) > 10;
      `);

      for (const match of matches.recordset) {
        const source = sourceRows.get(
          normalize(match.InvestorCode)
        );

        if (!source) {
          continue;
        }

        const row = {
          ...source,
          BoNumber: String(match.BoNumber).trim()
        };

        matchedRows.set(
          recordKey(row.InvestorCode, row.BoNumber),
          row
        );
      }
    }

    if (!matchedRows.size) {
      return [];
    }

    const localPool = await this.pool();
    const existingKeys = new Set();

    const matchedCodes = [
      ...new Set(
        [...matchedRows.values()].map(
          row => row.InvestorCode
        )
      )
    ];

    for (
      let index = 0;
      index < matchedCodes.length;
      index += 500
    ) {
      const request = localPool.request();

      const parameters = matchedCodes
        .slice(index, index + 500)
        .map((code, position) => {
          request.input(
            `k${position}`,
            Db.sql.NVarChar(50),
            code
          );

          return `@k${position}`;
        });

      const existing = await request.query(`
        SELECT
          InvestorCode,
          BoNumber
        FROM dbo.CityAgentNotification
        WHERE InvestorCode IN (
          ${parameters.join(',')}
        );
      `);

      for (const row of existing.recordset) {
        existingKeys.add(
          recordKey(row.InvestorCode, row.BoNumber)
        );
      }
    }

    return [...matchedRows.entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([, row]) => row);
  }

  async insertCandidate(row) {
    const pool = await this.pool();

    const result = await pool.request()
      .input(
        'masterId',
        Db.sql.Int,
        row.BORegistrationMasterID ?? null
      )
      .input(
        'code',
        Db.sql.NVarChar(50),
        row.InvestorCode
      )
      .input(
        'bo',
        Db.sql.NVarChar(50),
        row.BoNumber
      )
      .input(
        'agent',
        Db.sql.NVarChar(100),
        row.AgentRefCode || ''
      )
      .input(
        'date',
        Db.sql.DateTime,
        row.SourceInTimestamp || null
      )
      .query(`
        SET XACT_ABORT ON;

        BEGIN TRY
          BEGIN TRANSACTION;

          IF NOT EXISTS (
            SELECT 1
            FROM dbo.CityAgentNotification
              WITH (UPDLOCK, HOLDLOCK)
            WHERE InvestorCode = @code
              AND BoNumber = @bo
          )
          BEGIN
            INSERT INTO dbo.CityAgentNotification (
              BORegistrationMasterID,
              InvestorCode,
              BoNumber,
              AgentRefCode,
              SourceInTimestamp
            )
            VALUES (
              @masterId,
              @code,
              @bo,
              @agent,
              @date
            );

            SELECT 1 AS inserted;
          END
          ELSE
          BEGIN
            SELECT 0 AS inserted;
          END;

          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF XACT_STATE() <> 0
            ROLLBACK TRANSACTION;

          THROW;
        END CATCH;
      `);

    return result.recordset[0].inserted;
  }

  async findUnsent({
    limit,
    maxRetry,
    deliveryModule,
    mobileEnabled = true,
    emailEnabled = true
  }) {
    if (!mobileEnabled && !emailEnabled) {
      return [];
    }

    const pool = await this.pool();

    const result = await pool.request()
      .input('limit', Db.sql.Int, limit)
      .input('retry', Db.sql.Int, maxRetry)
      .input(
        'module',
        Db.sql.NVarChar(160),
        deliveryModule
      )
      .input(
        'recipientModule',
        Db.sql.NVarChar(60),
        this.bare
      )
      .input(
        'mobileEnabled',
        Db.sql.Bit,
        mobileEnabled
      )
      .input(
        'emailEnabled',
        Db.sql.Bit,
        emailEnabled
      )
      .query(`
        UPDATE dbo.NotificationDelivery
        SET
          State = 'UNKNOWN',
          UpdatedAt = SYSUTCDATETIME(),
          Error =
            'CityAgent worker expired; verify provider before retry'
        WHERE Module = @module
          AND State = 'IN_FLIGHT'
          AND LeaseUntil <= SYSUTCDATETIME();

        SELECT TOP (@limit)
          n.*,
          n.NotificationID AS Id
        FROM dbo.CityAgentNotification n
        WHERE n.BoNumber LIKE '1204500%'
          AND LEN(n.BoNumber) > 10
          AND EXISTS (
            SELECT 1
            FROM dbo.AgentInfo agent
            WHERE agent.refcode = n.AgentRefCode
              AND NULLIF(
                LTRIM(RTRIM(n.AgentRefCode)),
                ''
              ) IS NOT NULL
              AND LOWER(
                LTRIM(RTRIM(agent.refcode))
              ) <> 'city'
          )
          AND EXISTS (
            SELECT 1
            FROM (
              VALUES
                ('AGENT', 'MOBILE'),
                ('AGENT', 'EMAIL'),
                ('CITYBANK', 'MOBILE'),
                ('CITYBANK', 'EMAIL')
            ) v(Role, Via)
            WHERE (
              (
                v.Via = 'MOBILE'
                AND @mobileEnabled = 1
              )
              OR
              (
                v.Via = 'EMAIL'
                AND @emailEnabled = 1
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM dbo.NotificationRecipient r
              WHERE r.Module = @recipientModule
                AND r.NotificationID = n.NotificationID
                AND r.Role = v.Role
                AND r.Channel = v.Via
                AND (
                  r.IsSent = 1
                  OR r.RetryCount >= @retry
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM dbo.NotificationDelivery d
              WHERE d.Module = @module
                AND d.NotificationID =
                  CONVERT(NVARCHAR(100), n.NotificationID)
                AND d.RecipientRole = v.Role
                AND d.Via = v.Via
                AND d.State IN (
                  'IN_FLIGHT',
                  'UNKNOWN',
                  'SENT'
                )
            )
            AND EXISTS (
              SELECT 1
              FROM dbo.AgentInfo a
              WHERE a.refcode =
                CASE
                  WHEN v.Role = 'CITYBANK'
                    THEN 'city'
                  ELSE n.AgentRefCode
                END
                AND (
                  (
                    v.Via = 'MOBILE'
                    AND NULLIF(
                      LTRIM(RTRIM(a.mobile)),
                      ''
                    ) IS NOT NULL
                  )
                  OR
                  (
                    v.Via = 'EMAIL'
                    AND NULLIF(
                      LTRIM(RTRIM(a.email)),
                      ''
                    ) IS NOT NULL
                  )
                )
            )
          )
        ORDER BY n.NotificationID;
      `);

    return result.recordset;
  }

  async contacts(rows) {
    const codes = [
      ...new Set(
        [
          'city',
          ...rows.map(row =>
            String(row.AgentRefCode || '').trim()
          )
        ].filter(Boolean)
      )
    ];

    const pool = await this.pool();
    const contacts = new Map();

    for (
      let index = 0;
      index < codes.length;
      index += 500
    ) {
      const request = pool.request();

      const parameters = codes
        .slice(index, index + 500)
        .map((code, position) => {
          request.input(
            `r${position}`,
            Db.sql.NVarChar(100),
            code
          );

          return `@r${position}`;
        });

      const result = await request.query(`
        SELECT
          id,
          name,
          mobile,
          email,
          refcode
        FROM dbo.AgentInfo
        WHERE refcode IN (
          ${parameters.join(',')}
        )
        ORDER BY id;
      `);

      for (const row of result.recordset) {
        const key = normalize(row.refcode);

        if (contacts.has(key)) {
          throw new Error(
            `Duplicate AgentInfo refcode: ${row.refcode}`
          );
        }

        contacts.set(key, {
          name: row.name,
          mobile: first(row.mobile),
          email: first(row.email)
        });
      }
    }

    return contacts;
  }
}

module.exports = CityAgentRepository;
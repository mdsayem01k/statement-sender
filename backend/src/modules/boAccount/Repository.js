const crypto = require('crypto');
const Db = require('../../core/Db');

const first = value =>
  String(value || '').split(',')[0].trim();

const key = value =>
  String(value ?? '').trim().toUpperCase();

class Repository {
  constructor(settings) {
    this.settings = settings;
  }

  async ensureTables() {
    const pool = await Db.pool();

    await pool.request().query(`
      IF OBJECT_ID('dbo.BOAccountNotification', 'U') IS NULL
      CREATE TABLE dbo.BOAccountNotification (
        NotificationID INT IDENTITY(1,1) PRIMARY KEY,
        InvestorCode NVARCHAR(50) NOT NULL,
        BOID NVARCHAR(50) NOT NULL,
        ApprovedDate DATETIME2 NOT NULL,
        URLCode VARCHAR(48) NOT NULL UNIQUE,
        Data NVARCHAR(MAX) NOT NULL,
        DispatchAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_BOAccount_InvestorBO
          UNIQUE (InvestorCode, BOID)
      );
    `);
  }

  async source() {
    const pool = await Db.pool('poolPromise');

    const result = await pool.request()
      .input(
        'since',
        Db.sql.VarChar(19),
        this.settings.since
      )
      .query(`
        SELECT
          InvestorCode,
          InvestorName,
          boid AS BOID,
          virtualbankaccountNo AS VANumber,
          CellNo AS Mobile,
          Email,
          TraderID,
          ApprovedDate
        FROM dbo.testInvestor
        WHERE ApprovedDate >= CONVERT(DATETIME2, @since, 126)
          AND NULLIF(LTRIM(RTRIM(boid)), '') IS NOT NULL
          AND NULLIF(
            LTRIM(RTRIM(virtualbankaccountNo)),
            ''
          ) IS NOT NULL
        ORDER BY ApprovedDate, InvestorCode;
      `);

    return result.recordset;
  }

  async related(rows) {
    if (!rows.length) {
      return [];
    }

    const bo = await Db.pool('BOpoolPromise');
    const local = await Db.pool('poolPromise');

    const registrations = new Map();
    const rms = new Map();
    const agents = new Map();

    const put = (map, value, item) => {
      const normalizedKey = key(value);

      if (map.has(normalizedKey)) {
        throw new Error(
          `Ambiguous BO reference/contact mapping: ${normalizedKey}`
        );
      }

      map.set(normalizedKey, item);
    };

    for (let offset = 0; offset < rows.length; offset += 400) {
      const chunk = rows.slice(offset, offset + 400);
      const request = bo.request();

      const names = chunk.map((row, index) => {
        request.input(
          `c${index}`,
          Db.sql.NVarChar(50),
          row.InvestorCode
        );

        return `@c${index}`;
      });

      const result = await request.query(`
        SELECT
          ma.CustomCode AS InvestorCode,
          ma.BORegistrationMasterID,
          ma.BORegistrationNo,
          inv.isReferBO,
          inv.ReferBO AS AgentRefCode
        FROM dbo.Investor_tblBORegistrationMaster ma
        LEFT JOIN dbo.Investor_tblBOInvestorBOOpen inv
          ON inv.BORegistrationMasterID =
             ma.BORegistrationMasterID
        WHERE ma.CustomCode IN (${names.join(',')});
      `);

      for (const row of result.recordset) {
        put(registrations, row.InvestorCode, row);
      }
    }

    const rmResult = await local.request().query(`
      SELECT
        RMID,
        RMNAME,
        mobile,
        email,
        isActive
      FROM dbo.rm_info;
    `);

    for (const row of rmResult.recordset) {
      put(rms, row.RMID, row);
    }

    const agentResult = await local.request().query(`
      SELECT
        refcode,
        name,
        mobile,
        email
      FROM dbo.AgentInfo;
    `);

    for (const row of agentResult.recordset) {
      put(agents, row.refcode, row);
    }

    const defaultRm = {
      name: String(
        process.env.BO_ACCOUNT_DEFAULT_RM_NAME ||
        'Client Services Team'
      ).trim(),
      mobile: first(
        process.env.BO_ACCOUNT_DEFAULT_RM_MOBILE
      ),
      email: first(
        process.env.BO_ACCOUNT_DEFAULT_RM_EMAIL
      )
    };

    return rows.map(row => {
      const registration = registrations.get(
        key(row.InvestorCode)
      );

      const rm = rms.get(key(row.TraderID));

      const activeRm =
        rm &&
        ['1', 'true'].includes(
          String(rm.isActive).trim().toLowerCase()
        );

      const referral = ['1', 'true'].includes(
        String(
          registration?.isReferBO ?? ''
        ).trim().toLowerCase()
      );

      const agent = agents.get(
        key(registration?.AgentRefCode)
      );

      const bank = agents.get(
        key(this.settings.bankRef)
      );

      const rmContact = activeRm
        ? {
            name:
              String(rm.RMNAME || '').trim() ||
              defaultRm.name,
            mobile:
              first(rm.mobile) ||
              defaultRm.mobile,
            email:
              first(rm.email) ||
              defaultRm.email
          }
        : {
            ...defaultRm
          };

      return {
        InvestorCode: String(
          row.InvestorCode || ''
        ).trim(),

        InvestorName: String(
          row.InvestorName || ''
        ).trim(),

        BOID: String(
          row.BOID || ''
        ).trim(),

        VANumber: String(
          row.VANumber || ''
        ).trim(),

        Mobile: first(row.Mobile),
        Email: first(row.Email),

        ApprovedDate: row.ApprovedDate,

        RegistrationID:
          registration?.BORegistrationMasterID || null,

        RegistrationNo:
          registration?.BORegistrationNo || '',

        referral,

        AgentRefCode:
          registration?.AgentRefCode || '',

        rm: rmContact,

        agent: agent
          ? {
              name: agent.name,
              mobile: first(agent.mobile),
              email: first(agent.email)
            }
          : null,

        bank: bank
          ? {
              name: bank.name,
              mobile: first(bank.mobile),
              email: first(bank.email)
            }
          : null
      };
    });
  }

  async insert(data) {
    const pool = await Db.pool();

    const result = await pool.request()
      .input(
        'investor',
        Db.sql.NVarChar(50),
        data.InvestorCode
      )
      .input(
        'bo',
        Db.sql.NVarChar(50),
        data.BOID
      )
      .input(
        'approved',
        Db.sql.DateTime2,
        data.ApprovedDate
      )
      .input(
        'url',
        Db.sql.VarChar(48),
        crypto.randomBytes(24).toString('hex')
      )
      .input(
        'data',
        Db.sql.NVarChar(Db.sql.MAX),
        JSON.stringify(data)
      )
      .query(`
        SET XACT_ABORT ON;

        BEGIN TRY
          BEGIN TRANSACTION;

          IF NOT EXISTS (
            SELECT 1
            FROM dbo.BOAccountNotification
              WITH (UPDLOCK, HOLDLOCK)
            WHERE InvestorCode = @investor
              AND BOID = @bo
          )
          BEGIN
            INSERT INTO dbo.BOAccountNotification (
              InvestorCode,
              BOID,
              ApprovedDate,
              URLCode,
              Data
            )
            VALUES (
              @investor,
              @bo,
              @approved,
              @url,
              @data
            );
          END
          ELSE
          BEGIN
            UPDATE dbo.BOAccountNotification
            SET
              Data = @data,
              ApprovedDate = @approved
            WHERE InvestorCode = @investor
              AND BOID = @bo
              AND DispatchAt IS NULL;
          END;

          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF XACT_STATE() <> 0
            ROLLBACK TRANSACTION;

          THROW;
        END CATCH;
      `);

    return (result.rowsAffected || []).reduce(
      (sum, count) => sum + count,
      0
    );
  }

  async list({ offset = 0, limit = 25, q = '' }) {
    const pool = await Db.pool();

    const result = await pool.request()
      .input('offset', Db.sql.Int, offset)
      .input('limit', Db.sql.Int, limit)
      .input('q', Db.sql.NVarChar(50), q)
      .input(
        'since',
        Db.sql.VarChar(19),
        this.settings.since
      )
      .query(`
        SELECT
          *,
          COUNT(*) OVER() AS Total
        FROM dbo.BOAccountNotification
        WHERE ApprovedDate >= CONVERT(DATETIME2, @since, 126)
          AND (@q = '' OR InvestorCode = @q)
        ORDER BY NotificationID DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY;
      `);

    return {
      total: result.recordset[0]?.Total || 0,
      rows: result.recordset.map(row => this.parse(row))
    };
  }

  parse(row) {
    if (!row) {
      return null;
    }

    return {
      ...row,
      data: JSON.parse(row.Data),
      Data: undefined
    };
  }

  async find(id) {
    const pool = await Db.pool();

    const result = await pool.request()
      .input('id', Db.sql.Int, id)
      .query(`
        SELECT *
        FROM dbo.BOAccountNotification
        WHERE NotificationID = @id;
      `);

    return this.parse(result.recordset[0]);
  }

  async byUrl(code) {
    const pool = await Db.pool();

    const result = await pool.request()
      .input('code', Db.sql.VarChar(48), code)
      .query(`
        SELECT *
        FROM dbo.BOAccountNotification
        WHERE URLCode = @code;
      `);

    return this.parse(result.recordset[0]);
  }

  async dispatch(id) {
    const pool = await Db.pool();

    await pool.request()
      .input('id', Db.sql.Int, id)
      .query(`
        UPDATE dbo.BOAccountNotification
        SET DispatchAt = COALESCE(
          DispatchAt,
          SYSUTCDATETIME()
        )
        WHERE NotificationID = @id;
      `);

    return this.find(id);
  }

  async legacyDeliveries(item) {
    const pool = await Db.pool();

    const result = await pool.request()
      .input(
        'investor',
        Db.sql.NVarChar(50),
        item.InvestorCode
      )
      .input(
        'bo',
        Db.sql.NVarChar(50),
        item.BOID
      )
      .query(`
        IF OBJECT_ID('dbo.CityAgentNotification', 'U') IS NULL
        BEGIN
          SELECT
            CAST(NULL AS NVARCHAR(20)) AS RecipientRole,
            CAST(NULL AS NVARCHAR(10)) AS Via,
            CAST(NULL AS VARCHAR(16)) AS State
          WHERE 1 = 0;
        END
        ELSE
        BEGIN
          SELECT
            d.RecipientRole,
            d.Via,
            d.State
          FROM dbo.NotificationDelivery d
          JOIN dbo.CityAgentNotification n
            ON d.NotificationID =
               CONVERT(NVARCHAR(100), n.NotificationID)
          WHERE d.Module =
                'CITYAGENT:dbo.CityAgentNotification'
            AND n.InvestorCode = @investor
            AND n.BoNumber = @bo
            AND d.State IN (
              'IN_FLIGHT',
              'UNKNOWN',
              'ACCEPTED',
              'SENT'
            );
        END;
      `);

    return result.recordset;
  }

  async deliveries(id) {
    const pool = await Db.pool();

    const result = await pool.request()
      .input(
        'id',
        Db.sql.NVarChar(100),
        String(id)
      )
      .query(`
        SELECT
          RecipientRole,
          Via,
          State,
          Channel,
          Error,
          UpdatedAt
        FROM dbo.NotificationDelivery
        WHERE Module = 'BO_ACCOUNT'
          AND NotificationID = @id;
      `);

    return result.recordset;
  }
}

module.exports = Repository;
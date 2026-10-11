const Db = require('../core/Db');

function bangladeshDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

class SmsLimitService {
  async reserve(mobile) {
    const { sql } = Db;
    const pool = await Db.pool();

    const day = bangladeshDate();
    const date = new Date(`${day}T00:00:00Z`);
    const resource = `SMS_DAILY_LIMIT:${day}:${mobile}`;

    const result = await pool.request()
      .input('mobile', sql.VarChar(20), mobile)
      .input('smsDate', sql.Date, date)
      .input('resource', sql.NVarChar(255), resource)
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;

        BEGIN TRY
            BEGIN TRANSACTION;

            DECLARE @lockResult INT;

            EXEC @lockResult = sys.sp_getapplock
                @Resource = @resource,
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;

            IF @lockResult < 0
            BEGIN
                THROW 50001, 'Unable to acquire SMS limit lock.', 1;
            END;

            DECLARE @attemptCount INT;

            SELECT @attemptCount = AttemptCount
            FROM dbo.SmsDailyLimit
            WHERE SmsDate = @smsDate
              AND Mobile = @mobile;

            IF ISNULL(@attemptCount, 0) >= 3
            BEGIN
                COMMIT TRANSACTION;

                SELECT
                    CAST(0 AS BIT) AS allowed,
                    @attemptCount AS attemptCount;
            END
            ELSE
            BEGIN
                IF @attemptCount IS NULL
                BEGIN
                    INSERT INTO dbo.SmsDailyLimit
                    (
                        SmsDate,
                        Mobile,
                        AttemptCount,
                        UpdatedAt
                    )
                    VALUES
                    (
                        @smsDate,
                        @mobile,
                        1,
                        SYSUTCDATETIME()
                    );

                    SET @attemptCount = 1;
                END
                ELSE
                BEGIN
                    UPDATE dbo.SmsDailyLimit
                    SET AttemptCount = AttemptCount + 1,
                        UpdatedAt = SYSUTCDATETIME()
                    WHERE SmsDate = @smsDate
                      AND Mobile = @mobile;

                    SET @attemptCount = @attemptCount + 1;
                END;

                COMMIT TRANSACTION;

                SELECT
                    CAST(1 AS BIT) AS allowed,
                    @attemptCount AS attemptCount;
            END;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0
            BEGIN
                ROLLBACK TRANSACTION;
            END;

            THROW;
        END CATCH;
      `);

    const reservation = result.recordset?.[0];

    if (!reservation) {
      throw new Error('SMS limit reservation failed');
    }

    if (!reservation.allowed) {
      const error = new Error(
        `Daily SMS limit reached for ${mobile}. Maximum 3 attempts per day.`
      );

      error.statusCode = 429;
      error.errorType = 'SMS_DAILY_LIMIT';
      error.retryable = false;

      throw error;
    }

    return reservation;
  }
}

module.exports = SmsLimitService;
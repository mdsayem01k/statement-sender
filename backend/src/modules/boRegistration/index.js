const PdfDocumentModule = require('../../core/PdfDocumentModule');
const PdfDiskCache = require('../../core/PdfDiskCache');
const paths = require('../../config/paths');

const BoRegistrationRepository = require('./BoRegistrationRepository');
const BoStepRepository = require('./BoStepRepository');
const BoApplicationService = require('./BoApplicationService');
const BoStepSyncJob = require('./BoStepSyncJob');
const BoSubmissionSender = require('./BoSubmissionSender');
const files = require('./BoDocumentFiles');

const {
  config: accountConfig,
  boolean
} = require('../boAccount/config');

function toDate(value, name) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(
      `${name} must use YYYY-MM-DDTHH:mm:ss`
    );
  }

  const date = new Date(`${text}Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 19) !== text
  ) {
    throw new Error(
      `${name} is not a valid date/time`
    );
  }

  return date;
}

class BoRegistrationModule extends PdfDocumentModule {
  constructor(ctx) {
    super({
      ctx,
      type: 'BO_REGISTRATION',
      label: 'BO Registration',
      linkTemplate: '/api/bo/reg/report/pdf?BOID={code}',
      pdfRoutes: ['/bo/reg/report/pdf'],
      auditPrefix: 'BO_REGISTRATION_'
    });

    this.repository = new BoRegistrationRepository();

    this.application = new BoApplicationService({
      repository: this.repository,
      files
    });

    this.cache = new PdfDiskCache(paths.BO_PDF_DIR);

    const notifySince = toDate(
      process.env.BO_NOTIFY_SINCE,
      'BO_NOTIFY_SINCE'
    );

    if (!notifySince) {
      throw new Error(
        'BO_NOTIFY_SINCE is required before enabling BO notifications'
      );
    }

    const syncSince =
      toDate(
        process.env.BO_SYNC_SINCE,
        'BO_SYNC_SINCE'
      ) || notifySince;

    if (syncSince > notifySince) {
      throw new Error(
        'BO_SYNC_SINCE must not be later than BO_NOTIFY_SINCE'
      );
    }

    const intervalMin = Number(
      process.env.BO_SYNC_INTERVAL_MIN || 1
    );

    if (
      !Number.isFinite(intervalMin) ||
      intervalMin <= 0
    ) {
      throw new Error(
        'BO_SYNC_INTERVAL_MIN must be positive'
      );
    }

    const submissionSender = new BoSubmissionSender(
      ctx.messageCenter
    );

    this._job = new BoStepSyncJob({
      name: this.type,
      type: this.type,
      ctx: {
        ...ctx,
        messageCenter: submissionSender
      },
      emailEnabled: submissionSender.settings.emailEnabled,
      link: code => this.link(code),
      repository: new BoStepRepository(),
      intervalMin,
      syncSince,
      notifySince
    });

    this.account = null;

    if (
      boolean(
        process.env,
        'BO_ACCOUNT_ENABLED',
        false
      )
    ) {
      const AccountRepository = require('../boAccount/Repository');

      const {
        Service: AccountService
      } = require('../boAccount/Service');

      const settings = accountConfig();

      this.account = new AccountService(
        ctx,
        new AccountRepository(settings),
        settings
      );

      const syncSubmission =
        this._job.syncSource.bind(this._job);

      this._job.syncSource = async () => {
        const results = {};

        try {
          results.submission = await syncSubmission();
        } catch (error) {
          results.submissionError = error.message;

          console.error(
            '[BO SUBMISSION SYNC]',
            error.message
          );
        }

        try {
          results.account = await this.account.sync();
        } catch (error) {
          results.accountError = error.message;

          console.error(
            '[BO ACCOUNT SYNC]',
            error.message
          );
        }

        return results;
      };
    }

    this.getApplication =
      this.getApplication.bind(this);
  }

  get job() {
    return this._job;
  }

  routes() {
    const accountRoutes = this.account
      ? require('../boAccount/Routes')(this.account)
      : [];

    return [
      ...super.routes(),
      ...accountRoutes,
      {
        method: 'get',
        path: '/bo-registrations/:id/application',
        handler: this.getApplication
      }
    ];
  }

  async resolve(code) {
    const id =
      await this.repository.findMasterIdByUrlCode(code);

    return id ? { id, code } : null;
  }

  async renderPdf({ id, code }, req) {
    return this.cache.getOrCreate(
      code,
      () => this.application.buildPdf(id),
      {
        refresh: req.query.refresh === '1'
      }
    );
  }

  downloadName(record, code) {
    return `BO-Application-${code}.pdf`;
  }

  async getApplication(req, res) {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: 'Invalid registration id'
      });
    }

    const application =
      await this.application.getApplication(id);

    return res.json(application);
  }
}

module.exports = BoRegistrationModule;
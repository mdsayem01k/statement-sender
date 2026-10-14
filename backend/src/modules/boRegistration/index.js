const PdfDocumentModule = require('../../core/PdfDocumentModule');
const PdfDiskCache = require('../../core/PdfDiskCache');
const paths = require('../../config/paths');
const BoRegistrationRepository = require('./BoRegistrationRepository');
const BoStepRepository = require('./BoStepRepository');
const BoApplicationService = require('./BoApplicationService');
const BoStepSyncJob = require('./BoStepSyncJob');
const files = require('./BoDocumentFiles');

function toDate(value, name) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`${name} must use YYYY-MM-DDTHH:mm:ss`);
  }
  const date = new Date(`${text}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== text) {
    throw new Error(`${name} is not a valid date/time`);
  }
  return date;
}

class BoRegistrationModule extends PdfDocumentModule {
  constructor(ctx) {
    super({
      ctx,
      type: 'BO_REGISTRATION',
      label: 'BO Registration',
      linkTemplate: '/api/bo/reg/report/pdf?BOID={code}',     // same route as before
      pdfRoutes: ['/bo/reg/report/pdf'],
      auditPrefix: 'BO_REGISTRATION_',
    });
    this.repository = new BoRegistrationRepository();
    this.application = new BoApplicationService({ repository: this.repository, files });
    this.cache = new PdfDiskCache(paths.BO_PDF_DIR);
    const notifySince = toDate(process.env.BO_NOTIFY_SINCE, 'BO_NOTIFY_SINCE');
    if (!notifySince) throw new Error('BO_NOTIFY_SINCE is required before enabling BO notifications');
    const syncSince = toDate(process.env.BO_SYNC_SINCE, 'BO_SYNC_SINCE') || notifySince;
    if (syncSince > notifySince) throw new Error('BO_SYNC_SINCE must not be later than BO_NOTIFY_SINCE');
    const intervalMin = Number(process.env.BO_SYNC_INTERVAL_MIN || 1);
    if (!Number.isFinite(intervalMin) || intervalMin <= 0) throw new Error('BO_SYNC_INTERVAL_MIN must be positive');
    this._job = new BoStepSyncJob({
      name: this.type, type: this.type, ctx, link: (c) => this.link(c),
      repository: new BoStepRepository(),
      intervalMin,
      syncSince,
      notifySince,
    });
    this.getApplication = this.getApplication.bind(this);
  }

  get job() { return this._job; }

  routes() {
    return [
      ...super.routes(),
      { method: 'get', path: '/bo-registrations/:id/application', handler: this.getApplication }, // JSON for the React preview
    ];
  }

  async resolve(code) {
    const id = await this.repository.findMasterIdByUrlCode(code);
    return id ? { id, code } : null;
  }

  // PDF is built on the first request, then served from disk. ?refresh=1 rebuilds it.
  async renderPdf({ id, code }, req) {
    return this.cache.getOrCreate(code, () => this.application.buildPdf(id), { refresh: req.query.refresh === '1' });
  }

  downloadName(record, code) { return `BO-Application-${code}.pdf`; }

  async getApplication(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid registration id' });
    res.json(await this.application.getApplication(id));
  }
}

module.exports = BoRegistrationModule;

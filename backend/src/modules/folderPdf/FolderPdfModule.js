const { EVENT_TYPES } = require('../../utils/auditEvents');
const PdfDocumentModule = require('../../core/PdfDocumentModule');
const { HttpError, NotFoundError } = require('../../core/errors');
const PortfolioMapRepository = require('./PortfolioMapRepository');
const PdfBatchCopier = require('./PdfBatchCopier');
const UrlCodeMapService = require('./UrlCodeMapService');

const VIA = { mobile: ['MOBILE'], email: ['EMAIL'], all: ['MOBILE', 'EMAIL'] };

// A PDF that already exists in a folder (made by another system), found through the portfolioMap url code.
// Trade confirmation and Portfolio are two instances of THIS class with different folder settings.
class FolderPdfModule extends PdfDocumentModule {
  constructor({
    locator,                       // PdfLocator: where the PDFs are
    repository = new PortfolioMapRepository(),
    adminPrefix,                   // '/report' -> /report/resolve-code, /audit-logs, /urls, /copy-pdfs
    notifyRoute,                   // '/notify/trade-confirmation?code=X&via=mobile|email|all'
    generateRoute = null,          // '/portfoliomap/generate' (optional)
    legacy = {},                   // old URLs that must keep working: { urls, send, mail }
    urlBase,                       // base URL used by the "urls" report
    scheduleId = 2,
    ...pdf
  }) {
    super({ auditPrefix: '', ...pdf });
    this.locator = locator;
    this.repository = repository;
    this.adminPrefix = adminPrefix;
    this.notifyRoute = notifyRoute;
    this.generateRoute = generateRoute;
    this.legacy = legacy;
    this.urlBase = urlBase || this.ctx.env.app.pdfBaseUrl;
    this.scheduleId = scheduleId;
    this.copier = new PdfBatchCopier({ locator, expectedCodes: (id) => repository.expectedClientCodes(id) });
    this.codeMap = new UrlCodeMapService({ repository, locator });
    ['resolveCode', 'auditLogs', 'urls', 'copyPdfs', 'generateAll', 'generateOne', 'notify', 'notifyMobile', 'notifyEmail']
      .forEach((m) => { this[m] = this[m].bind(this); });
  }

  /* ---- PDF serving ---- */
  async resolve(code) {
    const row = await this.repository.findByUrlCode(code);
    return row ? { code: row.Code, insertDate: row.insert_date } : null;
  }

  async renderPdf({ code, insertDate }) {
    const { filePath, checkedPaths } = this.locator.locate(code, insertDate);
    if (!filePath) {
      throw new NotFoundError(`PDF not found for ${code}`, {
        auditMessage: `PDF not found in any location. Checked: ${checkedPaths.join(' | ')}`,
        publicMessage: 'This link has expired or the document is no longer available. Please contact support for a new copy.',
      });
    }
    return { file: filePath };
  }

  downloadName(record) { return `${record.code}.pdf`; }

  /* ---- routes ---- */
  routes() {
    const p = this.adminPrefix;
    const list = [
      ...super.routes(),
      { method: 'get', path: `${p}/resolve-code`, handler: this.resolveCode },
      { method: 'get', path: `${p}/audit-logs`, handler: this.auditLogs },
      { method: 'get', path: `${p}/urls`, handler: this.urls },
      { method: 'post', path: `${p}/copy-pdfs`, handler: this.copyPdfs },
      { method: 'get', path: this.notifyRoute, handler: this.notify },
    ];
    if (this.legacy.urls) list.push({ method: 'get', path: this.legacy.urls, handler: this.urls });
    if (this.legacy.send) list.push({ method: 'get', path: this.legacy.send, handler: this.notifyMobile });
    if (this.legacy.mail) list.push({ method: 'get', path: this.legacy.mail, handler: this.notifyEmail });
    if (this.generateRoute) {
      list.push({ method: 'get', path: this.generateRoute, handler: this.generateAll });
      list.push({ method: 'post', path: this.generateRoute, handler: this.generateOne });
    }
    return list;
  }

  /* ---- handlers (same JSON shapes as before) ---- */
  async resolveCode(req, res) {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing required query parameter: code' });
    const row = await this.repository.resolveUrlCode(code);
    if (!row) return res.status(404).json({ error: 'Invalid or expired code' });
    res.json(row);
  }

  async auditLogs(req, res) {
    const { clientCode, date, eventType = 'document' } = req.query;
    if (!EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: 'eventType must be all, document, proxy, notification or other' });
    }
    if (date && isNaN(Date.parse(date))) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    const logs = await this.ctx.audit.list({ resolvedCode: clientCode, date, eventType });
    res.json({ count: logs.length, data: logs });
  }

  async urls(req, res) {
    const { investorCode, date, allDates } = req.query;
    let when = null;
    if (allDates !== 'true') {
      when = date ? new Date(date) : new Date();
      if (isNaN(when.getTime())) throw new HttpError(400, 'Invalid date format');
    }
    const linkPrefix = `${this.urlBase}${this.linkTemplate.replace('{code}', '')}`;
    const data = await this.repository.findUrls({ investorCode, date: when, linkPrefix });
    res.json({ count: data.length, data });
  }

  async copyPdfs(req, res) {
    const scheduleID = req.query.scheduleID ? parseInt(req.query.scheduleID, 10) : this.scheduleId;
    const summary = await this.copier.copyToday(scheduleID);
    res.status(summary.matched ? 200 : 409).json(summary);
  }

  async generateAll(req, res) {
    const scheduleID = req.query.scheduleID ? parseInt(req.query.scheduleID, 10) : this.scheduleId;
    const results = await this.codeMap.processSchedule(scheduleID);
    if (!results.length) return res.status(404).json({ success: false, message: `No clientCode found for scheduleID=${scheduleID}` });
    res.json({ success: true, scheduleID, count: results.length, data: results });
  }

  async generateOne(req, res) {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, message: 'code is required' });
    res.status(201).json({ success: true, code, urlcode: await this.codeMap.createEntry(code) });
  }

  /* ---- send the link on demand: WhatsApp -> SMS fallback, and/or email ---- */
  notifyMobile(req, res) { return this.sendByCode(req, res, 'mobile'); }
  notifyEmail(req, res) { return this.sendByCode(req, res, 'email'); }
  notify(req, res) { return this.sendByCode(req, res, String(req.query.via || 'all').toLowerCase()); }

  async sendByCode(req, res, viaKey) {
    const code = String(req.params.code ?? req.query.code ?? req.body?.code ?? '').trim();
    if (!code) return res.status(400).json({ success: false, message: 'code is required' });
    const vias = VIA[viaKey];
    if (!vias) return res.status(400).json({ success: false, message: 'via must be mobile, email or all' });

    const who = { clientIp: req.ip, userAgent: req.get('user-agent') };
    const rawUrlcode = req.query.urlcode ?? req.body?.urlcode;
    const urlcode = rawUrlcode == null ? null : String(rawUrlcode).trim();
    if (urlcode !== null && !/^[A-Za-z0-9_-]{6,128}$/.test(urlcode)) {
      throw new HttpError(400, 'Invalid document URL code');
    }
    const contact = await this.repository.findContactByCode(code, urlcode);
    if (!contact) {
      await this.ctx.audit.save({ ...who, resolvedCode: code, status: 'FAILED', statusCode: 404, errorMessage: 'Portfolio mapping not found' });
      throw new HttpError(404, 'Document mapping not found for this investor and URL code.');
    }

    const recipient = { mobile: contact.mobile, email: contact.email, name: contact.investor };
    const data = { investor: contact.investor, url: this.link(contact.encrypto_code) };
    const meta = { ...who, encryptoCode: contact.encrypto_code, resolvedCode: code };

    const results = [];
    for (const via of vias) {
      try {
        const r = await this.ctx.messageCenter.send({ type: this.type, via, recipient, data, meta });
        results.push({ via, ok: true, channel: r.channel, messageText: r.messageText });
      } catch (err) {
        results.push({ via, ok: false, error: err.message, statusCode: err.statusCode || 500 });
      }
    }

    const ok = results.find((r) => r.ok);
    if (!ok) {
      const bad = results[0];
      return res.status(bad.statusCode).json({ success: false, message: bad.error, results });
    }
    // top-level channel/message kept for old clients of /api/send
    res.json({ success: true, investor: contact.investor, channel: ok.channel, message: ok.messageText, results });
  }
}

module.exports = FolderPdfModule;

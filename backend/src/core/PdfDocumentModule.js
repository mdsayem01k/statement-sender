const fs = require('fs');
const BaseModule = require('./BaseModule');
const { HttpError, NotFoundError } = require('./errors');
const { sendHtmlError } = require('../utils/htmlError');

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'UNKNOWN').split(',')[0].trim();

// A module whose link opens a PDF. The HTTP flow is written ONCE here:
//   read code -> validate -> resolve() -> renderPdf() -> audit -> send.
// A new PDF module only implements resolve() and renderPdf().
class PdfDocumentModule extends BaseModule {
  constructor({
    pdfRoutes = [],                              // e.g. ['/report/receipt/:param', '/report/receipt']
    codeParam = 'BOID',                          // query parameter that carries the url code
    codePattern = /^[A-Za-z0-9_-]{6,128}$/,
    auditPrefix = '',                            // '' keeps the old audit status names
    ...base
  }) {
    super(base);
    this.pdfRoutes = pdfRoutes;
    this.codeParam = codeParam;
    this.codePattern = codePattern;
    this.auditPrefix = auditPrefix;
    this.handlePdf = this.handlePdf.bind(this);
  }

  /* ---- implement these two ---- */
  // url code -> record (anything your renderPdf needs) or null when the code is unknown
  async resolve(/* code */) { throw new Error(`${this.type}: resolve() not implemented`); }
  // record -> { buffer } or { file }.  Throw NotFoundError when the document is not available.
  async renderPdf(/* record, req */) { throw new Error(`${this.type}: renderPdf() not implemented`); }

  /* ---- optional overrides ---- */
  resolvedCode(record) { return record?.code ?? null; }          // shown in the audit log
  downloadName(record, code) { return `${this.type}-${code}.pdf`; }

  extractCode(req) {
    const raw = req.params?.param ?? req.query?.[this.codeParam] ?? req.query?.id ?? '';
    return String(raw).replace(/^id=/i, '').trim();
  }

  routes() {
    return this.pdfRoutes.map((path) => ({ method: 'get', path, handler: this.handlePdf }));
  }

  async handlePdf(req, res) {
    const who = { clientIp: clientIp(req), userAgent: req.headers['user-agent'] };
    const log = (encryptoCode, resolvedCode, status, statusCode, errorMessage = null) =>
      this.ctx.audit.save({ ...who, encryptoCode, resolvedCode, status: this.auditPrefix + status, statusCode, errorMessage });

    const code = this.extractCode(req);
    if (!code) {
      log(null, null, 'REJECTED_MISSING_PARAM', 400, 'Code parameter was missing.');
      return sendHtmlError(res, 400, 'Bad Request', `Missing required parameter: <strong>${this.codeParam}</strong>.`);
    }
    if (!this.codePattern.test(code)) {
      log(code, null, 'INVALID_CODE_FORMAT', 400, 'Code has an invalid format');
      return sendHtmlError(res, 400, 'Bad Request', 'Invalid document code.');
    }

    let resolved = null;
    try {
      const record = await this.resolve(code);
      if (!record) {
        log(code, null, 'INVALID_ENCRYPTO_CODE', 404, 'Encrypted code not found');
        return sendHtmlError(res, 404, 'Not Found', 'Invalid or expired document code.');
      }
      resolved = this.resolvedCode(record);

      let out;
      try {
        out = await this.renderPdf(record, req);
      } catch (err) {
        if (err instanceof NotFoundError) {
          log(code, resolved, 'FILE_NOT_FOUND', 404, err.auditMessage || err.message);
          return sendHtmlError(res, 404, 'Document Unavailable', err.publicMessage || err.message);
        }
        throw err;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${this.downloadName(record, code)}"`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      if (out.cached !== undefined) res.setHeader('X-PDF-Source', out.cached ? 'cache' : 'generated');

      if (out.buffer) {
        log(code, resolved, 'SUCCESS', 200);
        return res.send(out.buffer);
      }

      const stream = fs.createReadStream(out.file);
      stream.on('error', (e) => {
        console.error('[STREAM ERROR]', e.message);
        log(code, resolved, 'STREAM_ERROR', 500, e.message);
        if (!res.headersSent) {
          res.removeHeader('Content-Type');
          return sendHtmlError(res, 500, 'Internal Server Error', 'Failed to read document file.');
        }
        res.destroy();
      });
      stream.on('open', () => log(code, resolved, 'SUCCESS', 200));
      stream.pipe(res);
    } catch (err) {
      console.error(`[${this.type} PDF]`, err.message);
      log(code, resolved, 'SERVER_ERROR', err.statusCode || 500, err.message);
      const status = err instanceof HttpError ? err.statusCode : 500;
      return sendHtmlError(res, status, status === 500 ? 'Internal Server Error' : 'Error',
        status === 500 ? 'An error occurred processing your request.' : err.message);
    }
  }
}

module.exports = PdfDocumentModule;

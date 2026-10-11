// Every feature (trade confirmation, receipt, BO registration, payment ...) is a module.
// A module owns: its link (what we send to the investor), its routes, and optionally a background job.
class BaseModule {
  // linkTemplate example: '/api/report/receipt/id={code}'
  constructor({ ctx, type, label, linkTemplate }) {
    this.ctx = ctx;           // shared services: { env, audit, messageCenter }
    this.type = type;         // must match a key in config/messageTemplates.json
    this.label = label || type;
    this.linkTemplate = linkTemplate;
  }

  // full public URL sent in WhatsApp / SMS / email
  link(code, baseUrl = this.ctx.env.app.pdfBaseUrl) {
    return `${baseUrl}${this.linkTemplate.replace('{code}', encodeURIComponent(code))}`;
  }

  // routes, mounted under /api: [{ method: 'get', path: '/x', handler }]
  routes() { return []; }

  // optional background sync + notify job (a NotificationJob) or null
  get job() { return null; }
}

module.exports = BaseModule;

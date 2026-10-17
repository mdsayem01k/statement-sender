const NotificationPipeline = require('./NotificationPipeline');
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Knows every module. server.js asks it to mount routes and start jobs.
// Adding a module = registering it in bootstrap/modules.js (one line).
class ModuleRegistry {
  constructor() {
    this.modules = new Map();
  }

  register(module) {
    if (this.modules.has(module.type)) throw new Error(`Module "${module.type}" is registered twice`);
    this.modules.set(module.type, module);
    return this; // chainable
  }

  get(type) { return this.modules.get(type); }
  all() { return [...this.modules.values()]; }

  // every route of every module: [{ module, method, path }]
  listRoutes() {
    return this.all().flatMap((m) =>
      m.routes().map((r) => ({ module: m.type, method: r.method.toUpperCase(), path: `/api${r.path}` })));
  }

  mountRoutes(router) {
    router.get('/routes', (req, res) => res.json({ count: this.listRoutes().length, routes: this.listRoutes() }));
    for (const m of this.all()) {
      for (const { method, path, handler } of m.routes()) router[method](path, wrap(handler));
    }
    // ops endpoints for every module that has a job (replaces the commented bo-step-sync routes)
    router.get('/jobs/status', (req, res) => {
      res.json({ success: true, pipeline: this.pipeline?.status() || null, jobs: this.all().filter((m) => m.job).map((m) => m.job.status()) });
    });
    router.post('/jobs/pipeline/run', wrap(async (req, res) => {
      res.json({ success: true, ...(await this.getPipeline().run()) });
    }));
    router.post('/jobs/:type/run', wrap(async (req, res) => {
      const m = this.get(String(req.params.type).toUpperCase());
      if (!m?.job) return res.status(404).json({ success: false, message: 'No job for this module' });
      res.json({ success: true, ...(await this.getPipeline().run()) });
    }));
  }

  getPipeline() {
    if (!this.pipeline) {
      const types = ['RECEIPTREQ', 'PAYMENT', 'BO_REGISTRATION','CITYAGENT'];
      this.pipeline = new NotificationPipeline(types.map(type => this.get(type)?.job).filter(Boolean));
    }
    return this.pipeline;
  }

  startJobs() { return this.getPipeline().start(); }

  async stopJobs() {
    this.all().forEach(module => module.job?.stop());
    await this.pipeline?.stop();
  }

}

module.exports = ModuleRegistry;

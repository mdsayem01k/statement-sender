class NotificationPipeline {
  constructor(jobs, { intervalMin = process.env.PIPELINE_INTERVAL_MIN || '1' } = {}) {
    const interval = Number(intervalMin);
    if (!Number.isFinite(interval) || interval <= 0 || interval > 1440) {
      throw new Error('PIPELINE_INTERVAL_MIN must be greater than zero and at most 1440');
    }
    this.intervalMs = interval * 60000;
    this.jobs = jobs;
    this.enabled = false;
    this.active = null;
    this.timer = null;
    this.lastCycle = null;
  }

  async run() {
    if (this.active || this.jobs.some(job => job.running)) return { skipped: true };
    clearTimeout(this.timer);
    this.jobs.forEach(job => { job.running = true; });
    this.active = this.cycle();
    try {
      return await this.active;
    } finally {
      this.active = null;
      this.jobs.forEach(job => { job.running = false; });
      if (this.enabled) {
        this.timer = setTimeout(() => this.run().catch(error => console.error('[PIPELINE]', error.message)), this.intervalMs);
        this.timer.unref?.();
      }
    }
  }

  async cycle() {
    const summary = { startedAt: new Date().toISOString(), modules: {} };
    for (const job of this.jobs) {
      const result = summary.modules[job.type] = {};
      try {
        await job.repository.ensureTables();
        result.synced = await job.syncSource();
      } catch (error) {
        result.syncError = error.message;
      }
    }
    for (const job of this.jobs) {
      const result = summary.modules[job.type];
      try {
        await job.repository.ensureTables();
        result.sent = await job.sendPending();
      } catch (error) {
        result.sendError = error.message;
      }
      job.lastRun = { at: new Date(), ...result, error: result.syncError || result.sendError || null };
    }
    summary.finishedAt = new Date().toISOString();
    this.lastCycle = summary;
    console.log('[PIPELINE CYCLE]', JSON.stringify(summary));
    return summary;
  }

  start() {
    if (this.enabled) return this.active || Promise.resolve({ skipped: true });
    this.enabled = true;
    return this.run();
  }

  async stop() {
    this.enabled = false;
    clearTimeout(this.timer);
    if (this.active) await this.active;
  }

  status() {
    return { enabled: this.enabled, running: Boolean(this.active), intervalMs: this.intervalMs, lastCycle: this.lastCycle };
  }
}

module.exports = NotificationPipeline;

const fs = require('fs/promises');
const path = require('path');

// Builds a PDF once, keeps it on disk, serves the saved file afterwards.
// Two simultaneous requests for the same key build it only once.
class PdfDiskCache {
  constructor(dir) {
    this.dir = dir;
    this.inflight = new Map();
  }

  fileFor(key) { return path.join(this.dir, `${key}.pdf`); }

  async #exists(file) { return fs.access(file).then(() => true, () => false); }

  // build: async () => Buffer.   Returns { file, cached }
  async getOrCreate(key, build, { refresh = false } = {}) {
    const file = this.fileFor(key);
    if (!refresh && (await this.#exists(file))) return { file, cached: true };

    if (!this.inflight.has(key)) {
      const job = (async () => {
        const buffer = await build();
        await fs.mkdir(this.dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, buffer);
        await fs.rename(tmp, file); // atomic: nobody reads a half-written PDF
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    await this.inflight.get(key);
    return { file, cached: false };
  }
}

module.exports = PdfDiskCache;

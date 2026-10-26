const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Windows often holds a short lock on a fresh file (antivirus, indexing). Retry before giving up.
const LOCK_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

class PdfBatchCopier {
  constructor({ locator, expectedCodes }) {
    this.locator = locator;
    this.expectedCodes = expectedCodes; // async (scheduleID) => [clientCode, ...]
  }

  async copyWithRetry(src, dest, { retries = 4, delayMs = 400 } = {}) {
    for (let attempt = 1; ; attempt++) {
      try { return await fsp.copyFile(src, dest); }
      catch (err) {
        if (!LOCK_ERROR_CODES.has(err.code) || attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }

  async listSourcePdfs() {
    const entries = await fsp.readdir(this.locator.networkDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf')).map((e) => e.name);
  }

  // Copies today's PDFs from the network share into a local dated folder.
  // Gate: only when (expected clientCode count) === (PDF count on the share).
  async copyToday(scheduleID = 2) {
    const { networkDir, localRoot } = this.locator;
    const codes = await this.expectedCodes(scheduleID);
    const sourceCount = (await this.listSourcePdfs()).length;
    const documentDate = this.locator.todayFolder();

    const destDir = path.join(
      localRoot,
      this.locator.localFolder(documentDate)
    );

    const summary = {
      scheduleID, expectedCount: codes.length, sourceCount,
      matched: codes.length === sourceCount, destDir, copied: [], missing: [], errors: [],
    };

    if (!codes.length) { summary.message = `No clientCode rows found for scheduleID=${scheduleID}. Nothing to copy.`; return summary; }
    if (!summary.matched) {
      summary.message = `Count mismatch: expected ${codes.length} clientCode(s) but found ${sourceCount} PDF(s) on the network drive. No files were copied.`;
      return summary;
    }

    await fsp.mkdir(destDir, { recursive: true });
    for (const code of codes) {
      const fileName = this.locator.fileNameFor(code);
      const src = path.join(networkDir, fileName);
      try {
        if (!fs.existsSync(src)) { summary.missing.push(fileName); continue; }
        await this.copyWithRetry(src, path.join(destDir, fileName));
        summary.copied.push(fileName);
      } catch (err) {
        summary.errors.push({
          fileName, error: err.message, code: err.code,
          note: LOCK_ERROR_CODES.has(err.code) ? 'File stayed locked after several retries (antivirus or another process).' : undefined,
        });
      }
    }
    summary.message = `Copied ${summary.copied.length} of ${codes.length} expected PDF(s) to ${destDir}.`;
    return summary;
  }
}

module.exports = PdfBatchCopier;

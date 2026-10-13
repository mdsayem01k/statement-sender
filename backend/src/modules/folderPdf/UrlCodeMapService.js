const { generateShortUrlCode } = require('../../utils/urlCode');

// Creates url codes for investors (one row per code in portfolioMap).
class UrlCodeMapService {
  constructor({ repository, locator }) {
    this.repository = repository;
    this.locator = locator;
  }

  async createEntry(clientCode) {
    const urlcode = generateShortUrlCode(clientCode, 20);
    return this.repository.insert({ code: clientCode, urlcode, documentFilename: this.locator.fileNameFor(clientCode) });
  }

  async processSchedule(scheduleID = 2) {
    const results = [];
    const codes = [...new Set((await this.repository.expectedClientCodes(scheduleID)).map(code => String(code ?? '').trim()).filter(Boolean))];
    for (const clientCode of codes) {
      results.push({ clientCode, urlcode: await this.createEntry(clientCode) });
    }
    return results;
  }
}

module.exports = UrlCodeMapService;

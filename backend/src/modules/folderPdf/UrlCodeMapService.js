const { generateShortUrlCode } = require('../../utils/urlCode');

// Creates url codes for investors (one row per code in portfolioMap).
class UrlCodeMapService {
  constructor({ repository, locator }) {
    this.repository = repository;
    this.locator = locator;
  }

  async createEntry(clientCode) {
    const urlcode = generateShortUrlCode(clientCode, 20);
    await this.repository.insert({ code: clientCode, urlcode, documentFilename: this.locator.fileNameFor(clientCode) });
    return urlcode;
  }

  async processSchedule(scheduleID = 2) {
    const results = [];
    for (const clientCode of await this.repository.expectedClientCodes(scheduleID)) {
      results.push({ clientCode, urlcode: await this.createEntry(clientCode) });
    }
    return results;
  }
}

module.exports = UrlCodeMapService;

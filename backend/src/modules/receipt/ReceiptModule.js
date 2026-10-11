const PdfDocumentModule = require('../../core/PdfDocumentModule');
const ReceiptNotificationJob = require('./ReceiptNotificationJob');
const { buildReceiptPdf } = require('./buildReceiptPdf');
const { parseDescription } = require('./parseDescription');

const pad = (n) => String(n).padStart(2, '0');

// Base for every "money received" receipt: Deposit (cheque), Payment, ...
// A subclass passes its repository (the table) and labels. The PDF, the link and the job are shared.
class ReceiptModule extends PdfDocumentModule {
  constructor({ repository, tranType, job = {}, ...pdf }) {
    super({ codeParam: 'id', ...pdf });
    this.repository = repository;
    this.tranType = tranType;       // line "TRAN" on the receipt, e.g. 'CHEQUE PAYMENT'
    this._job = new ReceiptNotificationJob({
      name: this.type, type: this.type, repository, ctx: this.ctx, link: (c) => this.link(c), ...job,
    });
  }

  get job() { return this._job; }

  async resolve(code) {
    const row = await this.repository.findReceiptByUrlCode(code);
    return row ? { ...row, code: row.InvestorCode } : null;
  }

  async renderPdf(row) {
    return { buffer: await buildReceiptPdf(this.toPdfData(row)) };
  }

  downloadName() { return 'Receipt.pdf'; }

  toPdfData(row) {
    // mssql returns DATETIME as a UTC-flagged Date, so read it with the UTC getters
    const d = row.ReceiveDate ? new Date(row.ReceiveDate) : null;
    const { account, name } = parseDescription(row.Descriptions);
    return {
      bankName: 'City Brokerage Limited',
      date: d ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${String(d.getUTCFullYear()).slice(2)}` : '',
      time: d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '',
      atmName: name || '-',                              // INVESTOR NAME
      cardNo: row.InvestorCode || '',                    // INVESTOR ID
      tranType: this.tranType,
      ref: row.ReferenceNumber || String(row.SourceId),
      accountNo: account || row.InvestorCode || '',      // A/C NO
      amount: Number(row.Amount || 0).toFixed(2),
      currency: 'BDT',
      depositType: 'CITY BROKERAGE LIMITED',             // TRANS TO
      status: 'Transaction completed successfully',
      thankYou: 'Thank you for using City Brokerage Limited',
      helpline: '09678111111',
    };
  }
}

module.exports = ReceiptModule;

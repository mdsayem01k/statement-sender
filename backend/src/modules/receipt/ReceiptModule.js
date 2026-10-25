const PdfDocumentModule = require('../../core/PdfDocumentModule');
const ReceiptNotificationJob = require('./ReceiptNotificationJob');
const { buildReceiptPdf } = require('./buildReceiptPdf');
const { parseDescription } = require('./parseDescription');

const pad = value => String(value).padStart(2, '0');

class ReceiptModule extends PdfDocumentModule {
  constructor({
    repository,
    tranType,
    job = {},
    jobClass = ReceiptNotificationJob,
    ...pdf
  }) {
    super({
      codeParam: 'id',
      ...pdf
    });

    this.repository = repository;
    this.tranType = tranType;

    this._job = new jobClass({
      name: this.type,
      type: this.type,
      repository,
      ctx: this.ctx,
      link: code => this.link(code),
      ...job
    });
  }

  get job() {
    return this._job;
  }

  async resolve(code) {
    const row = await this.repository.findReceiptByUrlCode(
      code
    );

    return row
      ? {
          ...row,
          code: row.InvestorCode
        }
      : null;
  }

  async renderPdf(row) {
    return {
      buffer: await buildReceiptPdf(
        this.toPdfData(row)
      )
    };
  }

  downloadName() {
    return 'Receipt.pdf';
  }

  toPdfData(row) {
    const date = row.ReceiveDate
      ? new Date(row.ReceiveDate)
      : null;

    const { account, name } = parseDescription(
      row.Descriptions
    );

    return {
      bankName: 'City Brokerage Limited',

      date: date
        ? `${pad(date.getUTCDate())}.` +
          `${pad(date.getUTCMonth() + 1)}.` +
          `${String(date.getUTCFullYear()).slice(2)}`
        : '',

      time: date
        ? `${pad(date.getUTCHours())}:` +
          `${pad(date.getUTCMinutes())}`
        : '',

      atmName: name || '-',
      cardNo: row.InvestorCode || '',
      tranType: this.tranType,
      ref: row.ReferenceNumber || String(row.SourceId),
      accountNo: account || row.InvestorCode || '',
      amount: Number(row.Amount || 0).toFixed(2),
      currency: 'BDT',
      depositType: 'CITY BROKERAGE LIMITED',
      status: 'Transaction completed successfully',
      thankYou: 'Thank you for using City Brokerage Limited',
      helpline: '09678111111'
    };
  }
}

module.exports = ReceiptModule;
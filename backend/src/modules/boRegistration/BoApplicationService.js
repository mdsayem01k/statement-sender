// SERVICE: shapes the BO database rows into the object the React preview and the PDF expect.
const { NotFoundError } = require('../../core/errors');
const buildBoPdf = require('./buildBoPdf');

const t = (v) => (v == null ? '' : String(v).trim());
const yn = (v) => (v === true || v === 1 || v === '1' ? 'YES' : 'NO');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const GENDER = { M: 'Male', F: 'Female', O: 'Other' };
const BO_TYPE = { 1: 'Individual' };

const DOCUMENT_LABELS = [
  "Applicant's Image", "Applicant's NID (Front)", "Applicant's NID (Back)", "Applicant's Cheque",
  'Nominee Image', 'Nominee NID / Birth Registration ID (Front)', 'Nominee NID / Birth Registration ID (Back)', 'Nominee Signature', "Applicant's Signature",
];

class BoApplicationService {
  constructor({ repository, files }) {
    this.repo = repository;
    this.files = files;
  }

  async getApplication(id) {
    const rows = await this.repo.findApplicationRows(id);
    const { master, basic, other, address, bank, nominees, payment } = rows;
    if (!master) throw new NotFoundError(`BO registration ${id} not found`);

    const b = basic || {}, o = other || {}, a = address || {}, k = bank || {};

    const [bankName, branchName] = await Promise.all([
      this.repo.lookupName('bank', k.BankID),
      this.repo.lookupName('branch', k.BankBranchID),
    ]);

    const nomineeFields = [];
    for (let i = 0; i < nominees.length; i++) {
      const n = nominees[i];
      const [country, state, city] = await Promise.all([
        this.repo.lookupName('country', n.Country),
        this.repo.lookupName('state', n.State),
        this.repo.lookupName('city', n.City),
      ]);
      nomineeFields.push(
        ['#', `Nominee ${i + 1}`],
        ['Name', t(n.Name)], ['Father\'s Name', t(n.FatherName)],
        ['Mother\'s Name', t(n.MotherName)], ['Spouse\'s Name', t(n.SpouseName)],
        ['National ID (NID)', t(n.NID)], ['Mobile Number', t(n.CellNo)],
        ['Gender', GENDER[t(n.Gender)] || t(n.Gender)], ['Date of Birth', day(n.DOB)],
        ['Share Percentage (%)', t(n.ShareHolder)], ['Relationship', t(n.Relationship)],
        ['Mailing Address', t(n.MailingAddress)],
        ['Country', country], ['State / Division', state], ['City', city], ['Postal / Zip Code', t(n.Zip)],
      );
    }

    const sections = [
      {
        title: 'Personal Details',
        fields: [
          ['Reference Number', t(master.BORegistrationNo)], ['BO ID', ''],
          ['BO Type', BO_TYPE[master.BOTypeID] || ''], ['BO Category', 'Regular'],
          ['Name of First Holder', t(b.Name)], ['Contact Person', ''],
          ['Gender', GENDER[t(b.Gender)] || t(b.Gender)],
          ['Date of Birth', day(b.DOB)],
          ['Father/Husband', t(b.FatherName)], ['Mother\'s Name', t(b.MotherName)],
          ['Occupation', t(o.Occupation)],
          ['Residency Status', t(o.Citizens).toUpperCase() === 'BANGLADESH' ? 'RB' : 'NRB'],
          ['Citizenship', t(o.Citizens)],
          ['Present Address', t(a.PresentAddress)],
          ['City', t(a.PERCity)], ['State / Division', t(a.PERState)],
          ['Country', t(a.PERCountry)], ['Postal Code', t(a.PERPostalCode)],
          ['Mobile Number', t(master.CellNo)], ['Email Address', t(master.Email)],
          ['Fax Number', ''], ['Statement Cycle', t(o.StatementCycle)],
          ['First Holder NID', t(b.NID)],
          ['#', 'Short Name'],
          ['First Holder', t(b.Name)], ['Second Holder', ''], ['Third Holder', ''],
        ],
      },
      {
        title: 'Permanent Address',
        fields: [
          ['Permanent Address', t(a.PermanentAddress)], ['Country', t(a.Country)],
          ['State / Division', t(a.State)], ['City', t(a.City)], ['Postal Code', t(a.PostalCode)],
        ],
      },
      {
        title: 'Passport Details',
        fields: [
          ['Passport Number', t(o.PassportNo)], ['Issue Date', day(o.DateOfIssue)],
          ['Expiry Date', day(o.ValidityDate)], ['Place of Issue', t(o.PlaceOfIssue)],
        ],
      },
      {
        title: 'KYC Information',
        fields: [
          ['TIN', t(o.TIN)],
          ['MD / CEO Name (Company / Institution / Firm)', t(o.MdCeoName)],
          ['Nature of Business (Company / Institution / Firm)', t(o.BusinessNature)],
          ['Source of Funds', t(o.IncomeSource)],
          ['Approximate Annual Turn Over / Income', String(Number(o.YearlyIncome || 0))],
          ['UNSCRs Screening Passed?', yn(o.HasUnscr)],
          ['Domestic Sanctions List Check Passed?', yn(o.HasDomesticSanction)],
          ['Is Customer IP / PEP?', yn(o.IsIPsPEPs)],
          ['Adverse Media Coverage Identified?', yn(o.IsMediaNews)],
          ['Beneficial Ownership Verified?', yn(o.HasBeneficialOwn)],
          ['Valid Visa / Work Permit Held?', yn(o.HasWorkPermit)],
        ],
      },
      {
        title: 'Other Information',
        fields: [
          ['Link BO Account', 'NO'], ['Link BO ID', ''], ['Reference BO Account', ''], ['Reference', ''],
          ['City Infinity Mobile App Access', 'YES'],
        ],
      },
      { title: 'Nominee Information', fields: nomineeFields },
      {
        title: 'Bank Details',
        fields: [
          ['Routing Number', t(k.RoutingNo)], ['Bank Name', bankName],
          ['Branch Name', branchName], ['Account Number', t(k.BankAccountNo)],
        ],
      },
      {
        title: 'Payment Details',
        fields: [
          ['Payment Method', payment && payment.IsGateway ? 'Gateway' : '-'],
          ['Amount Paid', String(Number((payment && payment.Amount) || 0))],
          ['Transaction Reference ID', t(payment && payment.TransactionID)],
          ['Transaction Date', day(payment && payment.TransactionDate)],
        ],
      },
    ];

    const documents = await this.files.getDocuments(id, nominees.length);
    const applicantSignature = await this.files.getApplicantSignature(id).catch(() => '');

    return { sections, documents, applicantSignature };
  }

  // the PDF as a Buffer
  async buildPdf(id) {
    return buildBoPdf.buildBoPdf(await this.getApplication(id));
  }
}

module.exports = BoApplicationService;

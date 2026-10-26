export const modules = [
  {
  type: 'TRADE_CONFIRMATION',
  name: 'Trade Confirmation',
  slug: 'trade-confirmation',
  scheduleId: 2,
  prefix: '/report',
  notify: '/notify/trade-confirmation',
  pdf: '/report/pdf'
},
{
  type: 'PORTFOLIO',
  name: 'Portfolio',
  slug: 'portfolio',
  scheduleId: 1,
  prefix: '/portfolio',
  notify: '/notify/portfolio',
  pdf: '/report/portfolio'
},
  {
    type: 'BO_REGISTRATION',
    name: 'BO Registration',
    slug: 'bo-registration'
  },
  {
    type: 'RECEIPTVA',
    name: 'Deposit VA',
    slug: 'deposit'
  },
  {
    type: 'RECEIPTREQ',
    name: 'Deposit Requisition',
    slug: 'deposit-requisition'
  },
  {
    type: 'DEPOSIT_APPROVE',
    name: 'Deposit Approval',
    slug: 'deposit-approval'
  },
  {
    type: 'PAYMENT',
    name: 'Payment',
    slug: 'payment'
  }
];

export const apiBase = (
  import.meta.env.VITE_API_BASE || ''
).replace(/\/+$/, '');

export const documentBase = (
  import.meta.env.VITE_DOCUMENT_BASE || apiBase
).replace(/\/+$/, '');

export const environment =
  import.meta.env.VITE_ENV_LABEL || import.meta.env.MODE;


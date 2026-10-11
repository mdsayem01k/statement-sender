// Any format -> 8801XXXXXXXXX (WhatsApp). Returns '' if not a valid BD mobile.
function toIntl(mobile) {
  let d = String(mobile || '').replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^1\d{9}$/.test(d) ? `880${d}` : '';
}

// 8801XXXXXXXXX -> 01XXXXXXXXX (SMS API format)
const toLocal = (intl) => (intl ? `0${intl.slice(3)}` : '');

module.exports = { toIntl, toLocal };
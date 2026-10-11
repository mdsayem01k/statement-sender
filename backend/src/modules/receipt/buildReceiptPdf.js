const { jsPDF } = require('jspdf');

const PAGE_W = 80;        // mm, receipt roll width (use 58 for a small roll, and lower COLS to 32)
const MARGIN = 4;         // mm, left/right
const COLS = 40;          // characters per line
const FONT_SIZE = 8.5;    // pt, 40 columns of Courier fit in 72 mm at this size
const LINE_H = 4;         // mm per line
const PAD_Y = 6;          // mm, top/bottom padding
const LABEL_W = 14;       // label column width, so every colon lines up
const INK = [30, 30, 30];

const DASH = '-'.repeat(COLS);
const center = (s) => ' '.repeat(Math.max(0, Math.floor((COLS - s.length) / 2))) + s;

// word-wrap text to COLS characters
function wrap(text) {
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= COLS) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}
const centerWrap = (text) => wrap(text).map(center);

// "LABEL         : value", wraps long values with a hanging indent
function kv(label, value, labelW = LABEL_W) {
  const head = label.padEnd(labelW) + ': ';
  const room = COLS - head.length;
  const text = String(value ?? '');
  if (text.length <= room) return [(head + text).trimEnd()];
  const out = [];
  let rest = text;
  while (rest.length) {
    out.push((out.length ? ' '.repeat(head.length) : head) + rest.slice(0, room));
    rest = rest.slice(room);
  }
  return out;
}

async function buildReceiptPdf(r) {
  const lines = [
    ...centerWrap(String(r.bankName).toUpperCase()),
    DASH,
    ...kv('DATE', `${r.date}   TIME: ${r.time}`),
    ...kv('INVESTOR NAME', r.atmName),
    ...kv('INVESTOR ID', r.cardNo),
    '',
    DASH,
    ...kv('TRAN', r.tranType),
    ...kv('REF', r.ref),
    DASH,
    ...kv('A/C NO', r.accountNo),
    ...kv('DEPOSIT AMOUNT', `${r.amount} ${r.currency}`),
    ...kv('TRANS TO', r.depositType),
    '',
    ...centerWrap(String(r.status).toUpperCase()),
    '',
    DASH,
    ...centerWrap(String(r.thankYou).toUpperCase()),
    ...centerWrap(`FOR ASSISTANCE PLEASE CALL ${r.helpline}`),
  ];

  const pageH = PAD_Y * 2 + lines.length * LINE_H;
  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W, pageH] });

  doc.setFont('courier', 'normal');
  doc.setFontSize(FONT_SIZE);
  doc.setTextColor(...INK);

  let y = PAD_Y + 2.5;
  for (const line of lines) {
    if (line) doc.text(line, MARGIN, y);
    y += LINE_H;
  }

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { buildReceiptPdf };
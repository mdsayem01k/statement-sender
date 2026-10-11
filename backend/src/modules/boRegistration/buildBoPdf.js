const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { jsPDF } = require('jspdf');
const autoTableModule = require('jspdf-autotable');
const autoTable = autoTableModule.default || autoTableModule;

const DECLARATION =
  'The rules and regulations of the Depository and CDBL Participant pertaining to an account which are in force now have been read by me/us and I/we have understood the same and I/we agree to abide by and to be bound by the rules as are in force from time to time for such accounts. I/We also declare that the particulars given by me/us are true to the best of my/our knowledge as on the date of making such application. I/We further agree that any false/misleading information given by me/us or suppression of any material fact will render my/our account liable for termination and further action.)';

const { PUBLIC_DIR } = require('../../config/paths');

const LOGO_FILE = path.join(PUBLIC_DIR, 'images', 'city-logo.png');
const FONT_FILES = {
  normal: path.join(PUBLIC_DIR, 'fonts', 'Poppins-Regular.ttf'),
  bold: path.join(PUBLIC_DIR, 'fonts', 'Poppins-SemiBold.ttf'),
};

const RED = [170, 0, 0];
const INK = [6, 44, 51];
const MUTED = [91, 111, 116];
const LINE = [217, 224, 226];
const SOFT = [244, 246, 247];
const FAINT = [154, 169, 173];
const M = 12, W = 210, H = 297, CW = W - 2 * M;

/* ---------- fonts (read once, kept in memory) ---------- */
let fontCache;
function registerPoppins(doc) {
  try {
    fontCache = fontCache || Object.fromEntries(
      Object.entries(FONT_FILES).map(([style, f]) => [style, fs.readFileSync(f).toString('base64')])
    );
    for (const [style, base64] of Object.entries(fontCache)) {
      const file = `Poppins-${style}.ttf`;
      doc.addFileToVFS(file, base64);
      doc.addFont(file, 'Poppins', style);
    }
    return 'Poppins';
  } catch (err) {
    fontCache = undefined;
    console.warn('[PDF] Poppins not loaded, using Helvetica:', err.message);
    return 'helvetica';
  }
}

/* ---------- images: data URL / Buffer -> shrunk JPEG + size ---------- */
async function loadImage(src) {
  let buf;
  if (Buffer.isBuffer(src)) buf = src;
  else if (typeof src === 'string' && src.startsWith('data:')) buf = Buffer.from(src.split(',')[1], 'base64');
  else throw new Error('Unsupported image source');

  const { data, info } = await sharp(buf)
    .rotate()                                   // respect phone-camera orientation
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })         // transparent PNG -> white
    .jpeg({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  return { data: `data:image/jpeg;base64,${data.toString('base64')}`, w: info.width, h: info.height };
}

/* ---------- table rows ---------- */
const FULL_ROW = new Set(['address', 'present address', 'permanent address', 'mailing address']);

function toRows(fields) {
  const rows = [];
  let pend = null;
  const flush = () => { if (pend) { rows.push([pend[0], pend[1], '', '']); pend = null; } };
  for (const [l, v] of fields) {
    if (l === '#') {
      flush();
      rows.push([{ content: v, colSpan: 4, styles: { fontStyle: 'bold', textColor: RED, fontSize: 9.5, cellPadding: { top: 3, bottom: 1, left: 1.5, right: 1.5 } } }]);
      continue;
    }
    const s = v === '' || v == null ? '—' : String(v);
    if (s.length > 34 || FULL_ROW.has(String(l).trim().toLowerCase())) { flush(); rows.push([l, { content: s, colSpan: 3 }]); continue; }
    if (pend) { rows.push([pend[0], pend[1], l, s]); pend = null; } else pend = [l, s];
  }
  flush();
  return rows;
}

/* ---------- main: returns a Buffer ---------- */
async function buildBoPdf({ sections, documents = {}, applicantSignature }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const FONT = registerPoppins(doc);
  let y = 0;
  const need = (h) => { if (y + h > H - 16) { doc.addPage(); y = 16; } };

  // Header band
  doc.setFillColor(...RED);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(...INK);
  doc.rect(0, 30, W, 1.4, 'F');

  let textX = M;
  try {
    const logo = await loadImage(fs.readFileSync(LOGO_FILE));
    let lh = 14, lw = (logo.w / logo.h) * lh;
    if (lw > 50) { lw = 50; lh = (logo.h / logo.w) * lw; }
    const boxH = lh + 4, boxY = (30 - boxH) / 2;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, boxY, lw + 8, boxH, 2, 2, 'F');
    doc.addImage(logo.data, 'JPEG', M + 4, boxY + 2, lw, lh);
    textX = M + lw + 8 + 6;
  } catch (e) { console.warn('[PDF] logo skipped:', e.message); }

  doc.setTextColor(255, 255, 255);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(18);
  doc.text('BO Account Application', textX, 14.5);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.text('City Brokerage Limited', textX, 21);
  y = 40;

  const bar = (title) => {
    need(26);
    doc.setFillColor(...SOFT);
    doc.rect(M, y, CW, 7, 'F');
    doc.setFillColor(...RED);
    doc.rect(M, y, 1.3, 7, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(title, M + 4, y + 4.9);
    y += 8;
  };

  for (const s of sections) {
    bar(s.title);
    autoTable(doc, {
      startY: y,
      body: toRows(s.fields),
      theme: 'plain',
      margin: { left: M, right: M, top: 16, bottom: 16 },
      styles: {
        font: FONT, fontSize: 8.5, textColor: INK, overflow: 'linebreak',
        cellPadding: { top: 1.7, bottom: 1.7, left: 1.5, right: 1.5 },
        lineColor: LINE, lineWidth: { bottom: 0.15 },
      },
      columnStyles: {
        0: { cellWidth: 38, textColor: MUTED },
        1: { cellWidth: 55, fontStyle: 'bold' },
        2: { cellWidth: 38, textColor: MUTED },
        3: { cellWidth: 55, fontStyle: 'bold' },
      },
      didParseCell: (d) => {
        if (d.cell.raw === '—') { d.cell.styles.textColor = FAINT; d.cell.styles.fontStyle = 'normal'; }
      },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Documents
  bar('Applicant documents');
  const cols = 4, gap = 4, tw = (CW - gap * 3) / cols, th = 30;
  const entries = Object.entries(documents);
  for (let i = 0; i < entries.length; i += cols) {
    need(th + 12);
    for (let j = 0; j < cols && i + j < entries.length; j++) {
      const [name, src] = entries[i + j];
      const x = M + j * (tw + gap);
      let img = null;
      if (src) { try { img = await loadImage(src); } catch { img = null; } }
      doc.setLineDashPattern([], 0);
      if (img) {
        const k = Math.min((tw - 2) / img.w, (th - 2) / img.h);
        const w = img.w * k, h = img.h * k;
        doc.addImage(img.data, 'JPEG', x + (tw - w) / 2, y + (th - h) / 2, w, h);
        doc.setDrawColor(...LINE);
        doc.rect(x, y, tw, th);
      } else {
        doc.setFillColor(...SOFT);
        doc.setDrawColor(...FAINT);
        doc.setLineDashPattern([1, 1], 0);
        doc.rect(x, y, tw, th, 'FD');
        doc.setLineDashPattern([], 0);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...FAINT);
        doc.text('Not uploaded', x + tw / 2, y + th / 2 + 1, { align: 'center' });
      }
      doc.setFont(FONT, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(name, tw), x, y + th + 4);
    }
    y += th + 12;
  }

  // Declaration + signature
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(DECLARATION, CW);
  const lh = 4.4;
  need(lines.length * lh + 50);
  bar('Declaration');
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.setLineHeightFactor(1.4);
  doc.text(lines, M, y + 3);
  y += lines.length * lh + 8;

  const sx = W - M - 65;
  if (applicantSignature) {
    try {
      const sig = await loadImage(applicantSignature);
      const k = Math.min(65 / sig.w, 18 / sig.h);
      doc.addImage(sig.data, 'JPEG', sx + (65 - sig.w * k) / 2, y + 18 - sig.h * k, sig.w * k, sig.h * k);
    } catch { /* leave signature area blank */ }
  }
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(sx, y + 19, sx + 65, y + 19);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.text("Applicant's signature", sx + 32.5, y + 24, { align: 'center' });

  // Page furniture
  const total = doc.getNumberOfPages();
  const date = new Date().toLocaleDateString('en-GB');
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) { doc.setFillColor(...RED); doc.rect(0, 0, W, 3, 'F'); }
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Generated on ${date}`, M, H - 8);
    doc.text(`Page ${p} of ${total}`, W - M, H - 8, { align: 'right' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { buildBoPdf };
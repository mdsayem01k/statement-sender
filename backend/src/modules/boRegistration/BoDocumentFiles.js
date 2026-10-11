// Reads BO document images from the file share and returns them as base64 data URLs.
//

// (the Windows account that runs Node must have read access to that share)
const fs = require('fs/promises');
const path = require('path');

const ROOT = process.env.BO_IMAGE_ROOT;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const EXTS = Object.keys(MIME).flatMap((e) => [e, e.toUpperCase()]);

// [label, folder, file name without extension]
const applicantDocs = (id) => [
  ["Applicant's Image", 'profile', `profile_${id}`],
  ["Applicant's NID (front)", 'nid', `nid_p1_${id}`],
  ["Applicant's NID (back)", 'nid', `nid_p2_${id}`],
  ["Applicant's Cheque", 'cheque', `cheque_${id}`],
 
];

const nomineeDocs = (id, n) => {
  const p = n === 1 ? 'Nominee ' : `Nominee ${n} `;
  return [
    [`${p}Image`, 'nomphoto', `nomphoto_${n}_${id}`],
    [`${p}NID / Birth ID`, 'nomnid', `nomnid_${n}_p1_${id}`],
    [`${p}NID / Birth ID (back)`, 'nomnid', `nomnid_${n}_p2_${id}`],
    [`${p}Signature`, 'nomsign', `nomsign_${n}_${id}`],
  ];
};

// Shown only when the file exists. Only tin_<id> was specified; the others assume <folder>_<id>.
const optionalDocs = (id) => [
  ['Passport', 'passport', `passport_${id}`],
  ['BO Payment', 'bopay', `bopay_${id}`],
  ['Employee Record', 'employeerecord', `employeerecord_${id}`],
  ['TIN', 'tin', `tin_${id}`],
  ['Trade License', 'tradelicense', `tradelicense_${id}`],
  ['Utility File', 'utilityfile', `utilityfile_${id}`],
];

async function readDataUrl(folder, baseName) {
  for (const ext of EXTS) {
    const file = path.join(ROOT, folder, `${baseName}.${ext}`);
    try {
      const buf = await fs.readFile(file);
      return `data:${MIME[ext.toLowerCase()]};base64,${buf.toString('base64')}`;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[BO FILE] ${file}: ${err.code || err.message}`);
    }
  }
  return '';
}

async function getDocuments(id, nomineeCount = 1) {
  const required = [
    ...applicantDocs(id),
    ...Array.from({ length: Math.max(1, nomineeCount) }, (_, i) => nomineeDocs(id, i + 1)).flat(),
  ];

  let rootOk = !!ROOT;
  if (!ROOT) console.warn('[BO FILE] BO_IMAGE_ROOT is not set');
  else {
    try { await fs.access(ROOT); } catch (err) { rootOk = false; console.warn(`[BO FILE] cannot open ${ROOT}: ${err.code || err.message}`); }
  }
  if (!rootOk) return Object.fromEntries(required.map(([label]) => [label, '']));

  const [req, opt] = await Promise.all([
    Promise.all(required.map(async ([label, folder, name]) => [label, await readDataUrl(folder, name)])),
    Promise.all(optionalDocs(id).map(async ([label, folder, name]) => [label, await readDataUrl(folder, name)])),
  ]);
  return Object.fromEntries([...req, ...opt.filter(([, data]) => data)]);
}

async function getApplicantSignature(id) {
  if (!ROOT) return '';
  for (const name of [`invsign${id}`, `invsign_${id}`]) {
    const data = await readDataUrl('invsign', name);
    if (data) return data;
  }
  return '';
}

module.exports = { getDocuments, getApplicantSignature };


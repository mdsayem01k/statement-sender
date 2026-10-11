const fs = require('fs');
const path = require('path');

const folderName = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Finds a client's PDF on disk. The ONLY things that differ between
// trade confirmation and portfolio are these 3 settings.
class PdfLocator {
  constructor({ networkDir, localRoot, filePrefix }) {
    this.networkDir = networkDir;   // flat share where the PDFs are produced
    this.localRoot = localRoot;     // local copy, one YYYY-MM-DD folder per day
    this.filePrefix = filePrefix;   // 'ConfirmationNote_' -> ConfirmationNote_0453.pdf
  }

  fileNameFor(code) { return path.basename(`${this.filePrefix}${code}.pdf`); }
  todayFolder() { return folderName(new Date()); }
  dayFolder(date) { return folderName(date); }

  // Checks: local folder of the day the url code was created -> today's local folder -> network share
  locate(code, insertDate = null) {
    const name = this.fileNameFor(code);
    const checkedPaths = [];
    const candidates = [];
    if (insertDate) candidates.push([path.join(this.localRoot, this.dayFolder(insertDate), name), 'local-original-date']);
    candidates.push([path.join(this.localRoot, this.todayFolder(), name), 'local-today']);
    candidates.push([path.join(this.networkDir, name), 'network']);

    for (const [filePath, source] of candidates) {
      checkedPaths.push(filePath);
      if (fs.existsSync(filePath)) return { filePath, source, checkedPaths };
    }
    return { filePath: null, source: null, checkedPaths };
  }
}

module.exports = PdfLocator;

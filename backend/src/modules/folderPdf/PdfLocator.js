const fs = require('fs');
const path = require('path');

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr',
  'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec'
];

function dateKey(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    throw new Error('PDF document date is missing');
  }

  let year;
  let month;
  let day;

  if (typeof value === 'string') {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/
    );

    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    }
  }

  if (year === undefined) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid PDF document date');
    }

    year = date.getUTCFullYear();
    month = date.getUTCMonth() + 1;
    day = date.getUTCDate();
  }

  const validated = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    validated.getUTCFullYear() !== year ||
    validated.getUTCMonth() + 1 !== month ||
    validated.getUTCDate() !== day
  ) {
    throw new Error('Invalid PDF document date');
  }

  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

class PdfLocator {
  constructor({
    networkDir,
    localRoot,
    filePrefix,
    archiveRoot = null,
    localFolderLayout = 'date'
  }) {
    this.networkDir = networkDir;
    this.localRoot = localRoot;
    this.filePrefix = filePrefix;

    if (
      !['date', 'month-day'].includes(localFolderLayout)
    ) {
      throw new Error('Invalid local PDF folder layout');
    }

    this.localFolderLayout = localFolderLayout;

    this.archiveRoot =
      typeof archiveRoot === 'string'
        ? archiveRoot.trim()
        : null;
  }

  fileNameFor(code) {
    const investorCode = String(code ?? '').trim();

    if (
      !investorCode ||
      /[\\/:*?"<>|]/.test(investorCode)
    ) {
      throw new Error(
        'Invalid investor code for PDF lookup'
      );
    }

    return path.basename(
      `${this.filePrefix}${investorCode}.pdf`
    );
  }

  todayFolder() {
    return todayKey();
  }

  dayFolder(date) {
    return dateKey(date);
  }

  archiveFolder(date) {
    const [year, month, day] = dateKey(date).split('-');

    const monthFolder =
      `${MONTHS[Number(month) - 1]}-${year}`;

    const dayFolder = `${day}${month}${year}`;

    return path.join(monthFolder, dayFolder);
  }

  localFolder(date) {
    return this.localFolderLayout === 'month-day'
      ? this.archiveFolder(date)
      : this.dayFolder(date);
  }

  locate(code, insertDate = null) {
    const checkedPaths = [];
    const errors = [];

    if (
      insertDate === null ||
      insertDate === undefined ||
      insertDate === ''
    ) {
      return {
        filePath: null,
        source: null,
        checkedPaths,
        errors: ['PDF document date is missing']
      };
    }

    const name = this.fileNameFor(code);
    const documentDate = this.dayFolder(insertDate);
    const candidates = [];

    if (this.archiveRoot) {
      candidates.push([
        path.join(
          this.archiveRoot,
          this.archiveFolder(insertDate),
          name
        ),
        'archive-original-date'
      ]);
    } else {
      errors.push('PDF archive root is not configured');
    }

    if (this.localRoot) {
      candidates.push([
        path.join(
          this.localRoot,
          this.localFolder(insertDate),
          name
        ),
        'local-original-date'
      ]);

      if (this.localFolderLayout === 'month-day') {
        candidates.push([
          path.join(
            this.localRoot,
            documentDate,
            name
          ),
          'local-legacy-original-date'
        ]);
      }
    }

    if (
      this.networkDir &&
      documentDate === this.todayFolder()
    ) {
      candidates.push([
        path.join(this.networkDir, name),
        'network-today'
      ]);
    }

    for (const [filePath, source] of candidates) {
      checkedPaths.push(filePath);

      try {
        const stats = fs.statSync(filePath);

        if (!stats.isFile()) {
          errors.push(`Not a file: ${filePath}`);
          continue;
        }

        fs.accessSync(filePath, fs.constants.R_OK);

        return {
          filePath,
          source,
          checkedPaths,
          errors
        };
      } catch (error) {
        errors.push(
          `${error.code || 'FILE_ERROR'}: ${filePath}`
        );

        if (
          error.code !== 'ENOENT' &&
          error.code !== 'ENOTDIR'
        ) {
          console.error('[PDF ACCESS ERROR]', {
            filePath,
            error: error.message,
            code: error.code
          });
        }
      }
    }

    console.error('[PDF NOT FOUND]', {
      investorCode: code,
      documentDate,
      archiveRoot: this.archiveRoot,
      localRoot: this.localRoot,
      localFolderLayout: this.localFolderLayout,
      filePrefix: this.filePrefix,
      checkedPaths,
      errors
    });

    return {
      filePath: null,
      source: null,
      checkedPaths,
      errors
    };
  }
}

module.exports = PdfLocator;
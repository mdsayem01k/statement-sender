import { apiBase, documentBase } from '../config/modules';

export function apiUrl(path, query = {}) {
  const params = new URLSearchParams(
    Object.entries(query).filter(
      ([, value]) => value !== '' && value != null
    )
  );

  return `${apiBase}/api${path}${
    params.size ? `?${params}` : ''
  }`;
}

export async function request(path, query = {}, options = {}) {
  const response = await fetch(apiUrl(path, query), {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers
    }
  });

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `API returned a non-JSON response (${response.status}). Check the API address and IIS routing.`
    );
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message ||
      data.error ||
      `Request failed (${response.status})`
    );
  }

  return data;
}

export function reportUrl(module, row) {
  const source = new URL(row.url, window.location.origin);
  const code = source.searchParams.get('BOID');

  if (!code) {
    throw new Error('The report link has no document code.');
  }

  return `${documentBase}/api${module.pdf}?BOID=${encodeURIComponent(code)}`;
}

export function classify(status = '') {
  if (status.endsWith('_SENT')) {
    return 'sent';
  }

  if (/FAILED|ERROR|REJECTED|INVALID|NOT_FOUND/.test(status)) {
    return 'error';
  }

  return 'access';
}

export function moduleType(status = '') {
  if (status.startsWith('RECEIPTREQ_')) {
    return 'RECEIPTREQ';
  }

  if (status.startsWith('RECEIPTVA_') || status.startsWith('RECEIPT_')) {
    return 'RECEIPTVA';
  }

  for (const type of [
    'TRADE_CONFIRMATION',
    'BO_REGISTRATION',
    'PORTFOLIO',
    'PAYMENT'
  ]) {
    if (status.startsWith(`${type}_`)) {
      return type;
    }
  }

  return 'TRADE_CONFIRMATION';
}

export function csvDownload(rows, filename) {
  const columns = [
    ...new Set(rows.flatMap(row => Object.keys(row)))
  ];

  const cell = value => {
    let text =
      typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : String(value ?? '');

    if (/^[=+@-]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replaceAll('"', '""')}"`;
  };

  const lines = [
    columns.map(cell).join(','),
    ...rows.map(row =>
      columns.map(column => cell(row[column])).join(',')
    )
  ];

  const blob = new Blob(
    ['\uFEFF' + lines.join('\r\n')],
    { type: 'text/csv;charset=utf-8' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
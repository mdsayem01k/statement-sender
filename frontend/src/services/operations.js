import { request } from './api';

export function documentCode(row) {
  const source = new URL(row.url, window.location.origin);
  const code = source.searchParams.get('BOID');
  if (!code || !/^[A-Za-z0-9_-]{6,128}$/.test(code)) throw new Error('The selected report has no valid document URL code.');
  return code;
}

export function uniqueTargets(rows) {
  const targets = new Map();
  for (const row of rows) {
    const code = String(row.investorCode ?? '').trim();
    if (!code) continue;
    const key = JSON.stringify([code, row.url]);
    if (!targets.has(key)) targets.set(key, { ...row, investorCode: code });
  }
  return [...targets.values()];
}

export function deliveryResult(data) {
  if (
    !Array.isArray(data.results) ||
    !data.results.length
  ) {
    throw new Error(
      'The server returned no delivery results. Check logs before retrying.'
    );
  }

  const failed = data.results.filter(result => !result.ok);

  if (failed.length) {
    throw new Error(
      failed
        .map(result => result.error || 'Delivery failed')
        .join('; ')
    );
  }

  return data.results
    .map(result => result.channel || result.via)
    .join(', ');
}

export async function sendNotification(module, row, via) {
  const data = await request(module.notify, {
    code: row.investorCode,
    urlcode: documentCode(row),
    via
  });

  return deliveryResult(data);
}

export function validSchedule(value) {
  const number = Number(value);

  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new Error(
      'Schedule ID must be a positive integer.'
    );
  }

  return number;
}
import { request } from './api';

export function uniqueTargets(rows) {
  const targets = new Map();

  for (const row of rows) {
    const code = String(row.investorCode ?? '').trim();

    if (code && !targets.has(code)) {
      targets.set(code, {
        ...row,
        investorCode: code
      });
    }
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

export async function sendNotification(module, code, via) {
  const data = await request(module.notify, {
    code,
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
export const PAGE_SIZE = 25;

export const STATUS_META = {
  SUCCESS: { label: 'Success', tone: 'ok' },
  INVALID_ENCRYPTO_CODE: { label: 'Invalid code', tone: 'warn' },
  FILE_NOT_FOUND: { label: 'File missing', tone: 'error' },
  REJECTED_MISSING_PARAM: { label: 'Missing param', tone: 'warn' },
  SERVER_ERROR: { label: 'Server error', tone: 'error' },
};

export function statusMeta(status) {
  return STATUS_META[status] || { label: status || 'Unknown', tone: 'muted' };
}

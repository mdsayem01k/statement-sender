const DOCUMENT_STATUSES = new Set([
  'SUCCESS', 'REJECTED_MISSING_PARAM', 'INVALID_CODE_FORMAT',
  'INVALID_ENCRYPTO_CODE', 'FILE_NOT_FOUND', 'STREAM_ERROR', 'SERVER_ERROR'
]);
const MODULES = [
  'TRADE_CONFIRMATION', 'PORTFOLIO', 'RECEIPTREQ',
  'DEPOSIT_APPROVE', 'RECEIPTVA', 'RECEIPT', 'PAYMENT', 'BO_REGISTRATION', 'CITYAGENT'
];
const EVENT_TYPES = ['all', 'document', 'proxy', 'notification', 'other'];
function normalizeIp(value) {
  return String(value || '').trim().replace(/^::ffff:/i, '');
}
function classifyAuditEvent(row, proxyIps) {
  const status = String(row.status || '').toUpperCase();
  const module = MODULES.find(type => status.startsWith(`${type}_`));
  const action = module ? status.slice(module.length + 1) : status;
  if (DOCUMENT_STATUSES.has(action)) {
    return proxyIps.has(normalizeIp(row.client_ip)) ? 'proxy' : 'document';
  }
  if (module || status === 'FAILED') return 'notification';
  return 'other';
}
function configuredProxyIps(value = process.env.AUDIT_PROXY_IPS) {
  const source = value === undefined ? '66.102.7.34,64.233.173.204' : value;
  return new Set(String(source).split(',').map(normalizeIp).filter(Boolean));
}
module.exports = { EVENT_TYPES, classifyAuditEvent, configuredProxyIps, normalizeIp };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hours24 = d.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())}, ${d.getUTCFullYear()}, ${pad(hours12)}:${pad(d.getUTCMinutes())} ${ampm}`;
}

export function todayLocalISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Windows 10/11" -> "Windows", "Chrome 134.0.0.0" -> "Chrome"
export function nameOnly(value) {
  if (!value) return 'Unknown';
  const stripped = value.replace(/\s+[0-9][0-9./_]*$/, '').trim();
  return stripped || value;
}

// "::ffff:192.168.216.26" -> "192.168.216.26"
export function cleanIp(value) {
  if (!value) return value;
  return value.replace(/^::ffff:/i, '');
}

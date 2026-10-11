const API_BASE = import.meta.env.VITE_API_BASE;

export async function fetchAuditLogs({ code, tradeDate } = {}) {
  const params = new URLSearchParams();
  if (code) params.set('clientCode', code);
  if (tradeDate) params.set('date', tradeDate);

  const res = await fetch(`${API_BASE}/api/report/audit-logs?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Search failed. Try again.');
  }
  return data.data || [];
}

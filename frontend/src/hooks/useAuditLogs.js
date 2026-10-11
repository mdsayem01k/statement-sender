import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs } from '../services/auditLogApi';

export default function useAuditLogs() {
  const [logs, setLogs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const load = useCallback(async (filters = {}) => {
    setError('');
    setLoading(true);
    setSearched(true);
    try {
      setLogs(await fetchAuditLogs(filters));
    } catch (err) {
      const isNetwork = err instanceof TypeError;
      setError(isNetwork
        ? 'Could not reach the server. Check your connection and try again.'
        : err.message);
      setLogs(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: all clients, all dates, newest first.
  useEffect(() => {
    load();
  }, [load]);

  return { logs, loading, error, searched, load };
}

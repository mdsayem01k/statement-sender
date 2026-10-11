import { useMemo, useState } from 'react';
import '../CSS/Clientlogsearch.css';

import SearchForm from '../components/SearchForm';
import SummaryToolbar from '../components/SummaryToolbar';
import LogsTable from '../components/LogsTable';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';
import useAuditLogs from '../hooks/useAuditLogs';
import usePagination from '../hooks/usePagination';
import { PAGE_SIZE } from '../constants/statusMeta';
import { todayLocalISODate } from '../utils/formatters';

export default function ClientLogSearch() {
  const [clientCode, setClientCode] = useState('');
  const [date, setDate] = useState(todayLocalISODate()); // pre-filled, applied only on Search
  const [statusTab, setStatusTab] = useState('all'); // 'all' | 'success'

  const { logs, loading, error, searched, load } = useAuditLogs();

  const successCount = logs ? logs.filter((l) => l.status === 'SUCCESS').length : 0;
  const failCount = logs ? logs.length - successCount : 0;

  const filteredLogs = useMemo(() => {
    if (!logs) return logs;
    return statusTab === 'success' ? logs.filter((l) => l.status === 'SUCCESS') : logs;
  }, [logs, statusTab]);

  const { page, totalPages, pageItems, goTo, from, to, total } =
    usePagination(filteredLogs, PAGE_SIZE);

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    setStatusTab('all');
    load({ code: clientCode.trim(), tradeDate: date });
  };

  const handleShowAll = () => {
    setClientCode('');
    setDate(todayLocalISODate());
    setStatusTab('all');
    load();
  };

  const ready = searched && !loading && !error && logs;

  return (
    <div className="cls-page">
      <header className="cls-header">
        <div className="cls-header-inner">
          <div className="cls-brand">
            <span className="cls-brand-mark">CBL</span>
            <span className="cls-brand-name">Document Access Log</span>
          </div>
          <p className="cls-header-sub">
            Search PDF access activity by client code and trade date. Showing all clients by default, newest first.
          </p>
        </div>
      </header>

      <main className="cls-main">
        <SearchForm
          clientCode={clientCode}
          date={date}
          loading={loading}
          onClientCodeChange={setClientCode}
          onDateChange={setDate}
          onSubmit={handleSearch}
          onShowAll={handleShowAll}
        />

        {error && <div className="cls-alert" role="alert">{error}</div>}

        {searched && !error && logs && logs.length > 0 && (
          <SummaryToolbar
            total={logs.length}
            successCount={successCount}
            failCount={failCount}
            statusTab={statusTab}
            onTabChange={setStatusTab}
          />
        )}

        {ready && logs.length === 0 && (
          <EmptyState title="No access records found." hint="Try a different client code or date." />
        )}

        {ready && logs.length > 0 && total === 0 && (
          <EmptyState title="No records match this filter." hint='Switch back to "All" to see every record.' />
        )}

        {pageItems && pageItems.length > 0 && (
          <>
            <LogsTable logs={pageItems} />
            <Pagination
              page={page}
              totalPages={totalPages}
              from={from}
              to={to}
              total={total}
              onPageChange={goTo}
            />
          </>
        )}
      </main>
    </div>
  );
}
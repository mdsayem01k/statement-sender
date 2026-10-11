export default function SummaryToolbar({ total, successCount, failCount, statusTab, onTabChange }) {
  const tabs = [
    { key: 'all', label: 'All', count: total },
    { key: 'success', label: 'Success', count: successCount },
  ];

  return (
    <div className="cls-toolbar">
      <div className="cls-summary">
        <span><strong>{total}</strong> record{total !== 1 ? 's' : ''}</span>
        <span className="cls-summary-dot ok" /><span>{successCount} success</span>
        <span className="cls-summary-dot error" /><span>{failCount} failed</span>
      </div>

      <div className="cls-tabs" role="tablist" aria-label="Filter by status">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={statusTab === t.key}
            className={`cls-tab ${statusTab === t.key ? 'active' : ''}`}
            onClick={() => onTabChange(t.key)}
          >
            {t.label} <span className="cls-tab-count">{t.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

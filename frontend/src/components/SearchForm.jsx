export default function SearchForm({
  clientCode, date, loading,
  onClientCodeChange, onDateChange, onSubmit, onShowAll,
}) {
  return (
    <form className="cls-search" onSubmit={onSubmit}>
      <div className="cls-field">
        <label htmlFor="clientCode">Client code</label>
        <input
          id="clientCode"
          type="text"
          placeholder="e.g. CLIENT_9001"
          value={clientCode}
          onChange={(e) => onClientCodeChange(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="cls-field">
        <label htmlFor="tradeDate">Trade date</label>
        <input
          id="tradeDate"
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>

      <div className="cls-actions">
        <button type="submit" className="cls-btn cls-btn-primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button type="button" className="cls-btn cls-btn-ghost" onClick={onShowAll} disabled={loading}>
          Show all
        </button>
      </div>
    </form>
  );
}

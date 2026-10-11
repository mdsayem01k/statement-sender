import LogRow from './LogRow';

const COLUMNS = [
  ['client', 'Client code'], ['status', 'Status'], ['url', 'URL'],
  ['trade-date', 'Trade date'], ['accessed', 'Accessed at'], ['ip', 'Client IP'],
  ['device', 'Device'], ['os', 'OS'], ['browser', 'Browser'], ['detail', 'Detail'],
];

export default function LogsTable({ logs }) {
  return (
    <div className="cls-table-wrap">
      <table className="cls-table">
        <colgroup>
          {COLUMNS.map(([key]) => <col key={key} className={`col-${key}`} />)}
        </colgroup>
        <thead>
          <tr>{COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {logs.map((log) => <LogRow key={log.id} log={log} />)}
        </tbody>
      </table>
    </div>
  );
}

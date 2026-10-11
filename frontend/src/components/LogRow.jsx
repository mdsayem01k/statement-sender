import { statusMeta } from '../constants/statusMeta';
import { cleanIp, formatDateTime, nameOnly } from '../utils/formatters';

export default function LogRow({ log }) {
  const meta = statusMeta(log.status);
  return (
    <tr>
      <td><span className="cls-mono" title={log.resolved_code || ''}>{log.resolved_code || '—'}</span></td>
      <td>
        <span className={`cls-status cls-status-${meta.tone}`}>
          <span className="cls-status-dot" />
          {meta.label}
        </span>
      </td>
      <td><span className="cls-mono" title={log.url || ''}>{log.url || '—'}</span></td>
      <td>{log.trade_date ? log.trade_date.slice(0, 10) : '—'}</td>
      <td>{formatDateTime(log.created_at)}</td>
      <td><span className="cls-mono" title={log.client_ip || ''}>{cleanIp(log.client_ip)}</span></td>
      <td><span className="cls-mono" title={log.device_type || ''}>{nameOnly(log.device_type)}</span></td>
      <td><span className="cls-mono" title={log.os_name || ''}>{nameOnly(log.os_name)}</span></td>
      <td><span className="cls-mono" title={log.browser_name || ''}>{nameOnly(log.browser_name)}</span></td>
      <td className="cls-detail" title={log.error_message || ''}>{log.error_message || '—'}</td>
    </tr>
  );
}

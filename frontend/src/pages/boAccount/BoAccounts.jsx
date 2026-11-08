import React, { useEffect, useRef, useState } from 'react';
import { request } from '../../services/api';
import './boAccounts.css';

export default function BoAccounts() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState([]);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const stopped = useRef(false);
  const locked = useRef(false);
  const controllers = useRef(new Set());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = true;
      controllers.current.forEach(controller => controller.abort());
    };
  }, []);

  async function api(path, query = {}, options = {}) {
    const controller = new AbortController();
    controllers.current.add(controller);
    try { return await request(path, query, { ...options, signal: controller.signal }); }
    finally { controllers.current.delete(controller); }
  }

  async function load(page = offset) {
    const data = await api('/bo/accounts', { offset: page, limit: 25, q });
    if (mounted.current) {
      setRows(data.rows); setTotal(data.total); setOffset(page);
      setSelected([]); setPreview([]);
    }
  }

  async function run(action) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setNotice(''); stopped.current = false;
    try { await action(); }
    catch (error) { if (mounted.current) setNotice(error.message); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  useEffect(() => { run(() => load(0)); }, []);

  async function prepare() {
    const entries = [];
    for (const id of selected) {
      if (stopped.current || !mounted.current) break;
      entries.push(await api(`/bo/accounts/${id}/preview`));
    }
    if (mounted.current) { setPreview(entries); setResults([]); }
  }

  async function send() {
    const outcomes = [];
    for (const entry of preview) {
      if (stopped.current || !mounted.current) break;
      const data = await api(`/bo/accounts/${entry.id}/send`, {}, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: entry.hash })
      });
      outcomes.push({ id: entry.id, results: data.results });
      if (mounted.current) setResults([...outcomes]);
    }
    if (mounted.current) {
      setPreview([]);
      setNotice('Finished. SENT/ACCEPTED deliveries are skipped on subsequent sends. UNKNOWN outcomes require review.');
    }
  }

  return <section className="bo-accounts">
    <h1>BO Notifications</h1>
    <p>Step-9 submission messages run automatically. Account-opening messages are sent here after IT review.</p>
    <div className="bo-controls">
      <input aria-label="Investor code" placeholder="Investor code" value={q} onChange={event => setQ(event.target.value)} disabled={busy} />
      <button disabled={busy} onClick={() => run(() => load(0))}>Search / Refresh</button>
      <button disabled={busy} onClick={() => run(async () => {
        const data = await api('/bo/accounts/sync', {}, { method: 'POST' });
        await load(0);
        if (mounted.current) setNotice(`Discovered ${data.fetched} accounts; ${data.stored} inserted or refreshed.`);
      })}>Discover ready accounts</button>
      <button disabled={busy || !selected.length} onClick={() => run(prepare)}>Preview selected ({selected.length})</button>
      <button disabled={!busy} onClick={() => { stopped.current = true; setNotice('Stopping after the current request.'); }}>Stop after current</button>
    </div>
    {notice && <p role="status" className="notice">{notice}</p>}
    <div className="table-wrap"><table>
      <thead><tr><th>Select</th><th>Investor</th><th>Name</th><th>BOID</th><th>VA</th><th>Approved date</th><th>Reference</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.NotificationID}>
        <td><input type="checkbox" aria-label={`Select ${row.InvestorCode}`} disabled={busy} checked={selected.includes(row.NotificationID)} onChange={event => {
          setSelected(event.target.checked ? [...selected, row.NotificationID] : selected.filter(id => id !== row.NotificationID));
          setPreview([]);
        }} /></td>
        <td>{row.InvestorCode}</td><td>{row.data.InvestorName}</td><td>{row.BOID}</td><td>{row.data.VANumber}</td>
        <td>{String(row.ApprovedDate).replace('T', ' ').replace(/Z$/, '')}</td>
        <td>{row.data.referral ? row.data.AgentRefCode : 'Direct'}</td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length && <p>No accounts found. Configure the backend and click Discover ready accounts.</p>}
    <div className="bo-controls">
      <button disabled={busy || offset === 0} onClick={() => run(() => load(Math.max(0, offset - 25)))}>Previous</button>
      <span>{total} accounts · Page {offset / 25 + 1}</span>
      <button disabled={busy || offset + 25 >= total} onClick={() => run(() => load(offset + 25))}>Next</button>
    </div>
    {!!preview.length && <>
      <h2>Message preview</h2>
      <p>Send time is fixed when sending starts. Existing accepted deliveries are skipped. Each recipient and channel is tracked separately.</p>
      {preview.map(entry => <article key={entry.id} className="bo-preview">
        <h3>Notification {entry.id}</h3>
        <a href={entry.ackUrl} target="_blank" rel="noreferrer">Open acknowledgement PDF</a>
        {!!entry.deliveries.length && <pre>{entry.deliveries.map(item => `${item.RecipientRole} / ${item.Via}: ${item.State}${item.Error ? ` — ${item.Error}` : ''}`).join('\n')}</pre>}
        {entry.plans.map(plan => <details key={`${plan.role}:${plan.via}`}>
          <summary>{plan.role} · {plan.via === 'EMAIL' ? 'Email' : plan.whatsappOnly ? 'WhatsApp only' : 'Configured WhatsApp / SMS order'} · {plan.recipient.mobile || plan.recipient.email || 'No contact'}</summary>
          {plan.error ? <p role="alert">Needs attention: {plan.error}</p> : <pre>{plan.text}</pre>}
        </details>)}
      </article>)}
      <button disabled={busy} onClick={() => run(send)}>Send notification to selected accounts</button>
    </>}
    {!!results.length && <><h2>Delivery results</h2>{results.map(entry => <article className="bo-preview" key={entry.id}>
      <h3>Notification {entry.id}</h3>
      <pre>{entry.results.map(item => `${item.role} / ${item.via}: ${item.state}${item.error ? ` — ${item.error}` : ''}`).join('\n')}</pre>
    </article>)}</>}
  </section>;
}

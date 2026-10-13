import React, { useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useParams
} from 'react-router-dom';
import { modules, environment } from './config/modules';
import {
  request,
  reportUrl,
  classify,
  moduleType,
  csvDownload
} from './services/api';
import ActionToolbar from './components/ActionToolbar';
import { sendNotification } from './services/operations';
import './App.css';

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const dateText = value =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        timeZone: 'Asia/Dhaka'
      })
    : '—';

function Notice({ children, error }) {
  return children ? (
    <div
      role={error ? 'alert' : 'status'}
      className={`notice ${error ? 'error' : ''}`}
    >
      {children}
    </div>
  ) : null;
}

function Table({ rows, columns }) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  const count = Math.max(1, Math.ceil(rows.length / 25));
  const visible = rows.slice((page - 1) * 25, page * 25);

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column.label}>{column.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visible.map((row, index) => (
              <tr key={row.id || index}>
                {columns.map(column => (
                  <td key={column.label}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {!rows.length && (
          <div className="empty">No records to display.</div>
        )}
      </div>

      <div className="pagination">
        <span>
          {rows.length} records · Page {page} of {count}
        </span>

        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>

        <button
          disabled={page >= count}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}

function ModulePage({ routes }) {
  const { slug } = useParams();
  return <ModulePageContent key={slug} routes={routes} />;
}

function ModulePageContent({ routes }) {
  const { slug } = useParams();
  const module = modules.find(item => item.slug === slug);

  const [code, setCode] = useState('');
  const [date, setDate] = useState(today());
  const [allDates, setAllDates] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');

  const operationLock = useRef(false);

  useEffect(() => {
    setRows([]);
    setError('');
    setMessage('');
    setPreview('');
    setCode('');
  }, [slug]);

  if (!module) {
    return <Notice error>Unknown module.</Notice>;
  }

  const available =
    module.prefix &&
    routes.some(
      route => route.path === `/api${module.prefix}/urls`
    );

  async function load(event) {
    event?.preventDefault();

    if (event && operationLock.current) {
      return;
    }

    setBusy(true);
    setError('');

    if (event) {
      setMessage('');
    }

    try {
      const data = await request(`${module.prefix}/urls`, {
        investorCode: code.trim(),
        date: allDates ? '' : date,
        allDates: allDates ? 'true' : ''
      });

      setRows(data.data || []);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function send(row, via) {
    if (operationLock.current) {
      return;
    }

    const channel =
      via === 'mobile'
        ? 'WhatsApp with SMS fallback'
        : via === 'all'
          ? 'mobile and email'
          : 'email';

    if (
      !window.confirm(
        `Send ${module.name} to investor ${row.investorCode} via ${channel}? The backend determines recipients and may use configured test contacts.`
      )
    ) {
      return;
    }

    operationLock.current = true;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const channels = await sendNotification(
        module,
        row,
        via
      );

      setMessage(
        `${channels} sent for ${row.investorCode}.`
      );
    } catch (error) {
      setError(error.message);
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  async function copy(row) {
    try {
      await navigator.clipboard.writeText(
        reportUrl(module, row)
      );

      setMessage('Report link copied.');
    } catch (error) {
      setError(error.message);
    }
  }

  const columns = [
    {
      label: 'Investor',
      render: row => row.investorCode
    },
    {
      label: 'Created',
      render: row => dateText(row.insert_date)
    },
    {
      label: 'Report',
      render: row => (
        <div className="actions">
          <button
            onClick={() => {
              try {
                setPreview(reportUrl(module, row));
              } catch (error) {
                setError(error.message);
              }
            }}
          >
            Preview
          </button>

          <button onClick={() => copy(row)}>
            Copy link
          </button>
        </div>
      )
    },
    {
      label: 'Send notification',
      render: row => (
        <div className="actions">
          <button
            disabled={busy}
            onClick={() => send(row, 'mobile')}
          >
            WhatsApp / SMS
          </button>

          <button
            disabled={busy}
            onClick={() => send(row, 'email')}
          >
            Email
          </button>

          <button
            disabled={busy}
            onClick={() => send(row, 'all')}
          >
            Both
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <h1>{module.name}</h1>

      <p className="subtitle">
        {module.notify
          ? 'Find reports and send document links to investors.'
          : 'Review this module’s activity in Access Logs and Daily Report.'}
      </p>

      {!module.prefix ? (
        <div className="panel">
          <h2>Logs and reporting</h2>

          <p>
            This backend module does not expose a report-list
            or manual-send API. Its recorded notifications
            and errors are included in the shared logs and
            daily report.
          </p>

          <NavLink to={`/logs?module=${module.type}`}>
            View module logs →
          </NavLink>
        </div>
      ) : !available ? (
        <Notice>
          This module’s report routes are currently unavailable.
          Refresh API status after enabling the module.
        </Notice>
      ) : (
        <>
          <form className="panel filters" onSubmit={load}>
            <label>
              Investor code
              <input
                value={code}
                onChange={event => setCode(event.target.value)}
                placeholder="All investors"
              />
            </label>

            <label>
              Report date
              <input
                type="date"
                required={!allDates}
                disabled={allDates}
                value={date}
                onChange={event => setDate(event.target.value)}
              />
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={allDates}
                onChange={event =>
                  setAllDates(event.target.checked)
                }
              />
              All dates
            </label>

            <button className="primary" disabled={busy}>
              Search reports
            </button>

            <button
              type="button"
              disabled={!rows.length}
              onClick={() =>
                csvDownload(rows, `${slug}-reports.csv`)
              }
            >
              Export CSV
            </button>
          </form>

          <Notice error>{error}</Notice>
          <Notice>{message}</Notice>

          <ActionToolbar
            key={module.type}
            module={module}
            routes={routes}
            rows={rows}
            busy={busy}
            setBusy={setBusy}
            operationLock={operationLock}
            setError={setError}
            setMessage={setMessage}
            reload={load}
          />

          <Table rows={rows} columns={columns} />

          {preview && (
            <section className="panel">
              <div className="section-head">
                <h2>PDF preview</h2>

                <a
                  href={preview}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open / download PDF
                </a>

                <button onClick={() => setPreview('')}>
                  Close
                </button>
              </div>

              <iframe title="Report PDF" src={preview} />
            </section>
          )}
        </>
      )}
    </>
  );
}

function Logs({ routes, daily = false }) {
  const [date, setDate] = useState(today());
  const [code, setCode] = useState('');

  const [module, setModule] = useState(
    new URLSearchParams(location.search).get('module') || ''
  );

  const [kind, setKind] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const endpoint = routes
    .find(route =>
      /\/(report|portfolio)\/audit-logs$/.test(route.path)
    )
    ?.path.replace(/^\/api/, '');

  async function load(event) {
    event?.preventDefault();

    setBusy(true);
    setError('');
    setLoaded(false);

    try {
      if (!endpoint) {
        throw new Error(
          'No shared audit-log endpoint is available.'
        );
      }

      const data = await request(endpoint, {
        clientCode: code.trim(),
        date
      });

      setRows(data.data || []);
      setLoaded(true);
    } catch (error) {
      setRows([]);
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  const selected = rows.filter(
    row =>
      (!module || moduleType(row.status) === module) &&
      (!kind || classify(row.status) === kind)
  );

  const notifications = selected.filter(
    row => classify(row.status) === 'sent'
  );

  const errors = selected.filter(
    row => classify(row.status) === 'error'
  );

  const totals = [
    ['Sent events', notifications.length],
    [
      'WhatsApp',
      notifications.filter(row =>
        row.status.endsWith('_WHATSAPP_SENT')
      ).length
    ],
    [
      'SMS',
      notifications.filter(row =>
        row.status.endsWith('_SMS_SENT')
      ).length
    ],
    [
      'Email',
      notifications.filter(row =>
        row.status.endsWith('_EMAIL_SENT')
      ).length
    ],
    ['Errors', errors.length]
  ];

  const summary = modules.map(item => {
    const events = selected.filter(
      row => moduleType(row.status) === item.type
    );

    return {
      module: item.name,
      sent: events.filter(
        row => classify(row.status) === 'sent'
      ).length,
      errors: events.filter(
        row => classify(row.status) === 'error'
      ).length
    };
  });

  const logColumns = [
    {
      label: 'Time',
      render: row => dateText(row.created_at)
    },
    {
      label: 'Module',
      render: row =>
        modules.find(
          item => item.type === moduleType(row.status)
        )?.name
    },
    {
      label: 'Investor',
      render: row => row.resolved_code || '—'
    },
    {
      label: 'Status',
      render: row => (
        <span className={`badge ${classify(row.status)}`}>
          {row.status}
        </span>
      )
    },
    {
      label: 'HTTP',
      render: row => row.status_code
    },
    {
      label: 'Role / IP',
      render: row =>
        `${row.recipient_role || '—'} / ${row.client_ip || '—'}`
    },  
    {
      label: 'Device',
      render: row => row.device_type || '—'
    },
    {
      label: 'Operating system',
      render: row => row.os_name || '—'
    },
    {
      label: 'Browser',
      render: row => row.browser_name || '—'
    },
    {
      label: 'Details',
      render: row => row.error_message || '—'
    }
  ];

  return (
    <>
      <h1>{daily ? 'Daily Report' : 'Access Logs'}</h1>

      <p className="subtitle">
        {daily
          ? 'Recorded notification sends and errors, across all modules.'
          : 'Document access, notification results, and errors from the shared audit log.'}
      </p>

      <form className="panel filters" onSubmit={load}>
        <label>
          Date
          <input
            type="date"
            required={daily}
            value={date}
            onChange={event => setDate(event.target.value)}
          />
        </label>

        <label>
          Investor code
          <input
            placeholder="All investors"
            value={code}
            onChange={event => setCode(event.target.value)}
          />
        </label>

        <label>
          Module
          <select
            value={module}
            onChange={event => setModule(event.target.value)}
          >
            <option value="">All modules</option>

            {modules.map(item => (
              <option key={item.type} value={item.type}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Event
          <select
            value={kind}
            onChange={event => setKind(event.target.value)}
          >
            <option value="">All events</option>
            <option value="sent">Sent</option>
            <option value="error">Error</option>
            <option value="access">Document access</option>
          </select>
        </label>

        <button className="primary" disabled={busy}>
          {busy ? 'Loading…' : 'Load logs'}
        </button>

        <button
          type="button"
          disabled={!selected.length}
          onClick={() =>
            csvDownload(
              selected,
              `audit-${date || 'all'}.csv`
            )
          }
        >
          Export CSV
        </button>
      </form>

      <Notice error>{error}</Notice>

      {daily && loaded && (
        <>
          <div className="stats">
            {totals.map(([label, number]) => (
              <div className="panel" key={label}>
                <span>{label}</span>
                <strong>{number}</strong>
              </div>
            ))}
          </div>

          <Table
            rows={summary}
            columns={[
              {
                label: 'Module',
                render: row => row.module
              },
              {
                label: 'Sent',
                render: row => row.sent
              },
              {
                label: 'Errors',
                render: row => row.errors
              }
            ]}
          />

          <p className="subtitle">
            Counts represent audit events, including repeat sends,
            rather than unique investors. Successful SMS fallback
            remains a sent event; its earlier channel error appears
            in Details. Dates follow the backend audit date.
          </p>
        </>
      )}

      <Table
        rows={
          daily
            ? selected.filter(
                row => classify(row.status) !== 'access'
              )
            : selected
        }
        columns={logColumns}
      />
    </>
  );
}

function Dashboard({ routes, jobs, refresh, error }) {
  return (
    <>
      <h1>Statement Sender</h1>

      <p className="subtitle">
        Reports, notifications, and daily operations in one place.
      </p>

      <Notice error>{error}</Notice>

      <div className="stats">
        <div className="panel">
          <span>Report modules</span>
          <strong>6</strong>
        </div>

        <div className="panel">
          <span>Registered API routes</span>
          <strong>{routes.length}</strong>
        </div>

        <div className="panel">
          <span>Background jobs</span>
          <strong>{jobs.length}</strong>
        </div>
      </div>

      <div className="cards">
        {modules.map(module => (
          <NavLink
            className="panel module-card"
            key={module.type}
            to={`/modules/${module.slug}`}
          >
            <span className="badge">
              {routes.some(
                route => route.module === module.type
              )
                ? 'Registered'
                : 'Unavailable'}
            </span>

            <h2>{module.name}</h2>

            <p>
              {module.notify
                ? 'Reports & notifications'
                : 'Module logs & daily results'}
            </p>

            <span>Open module →</span>
          </NavLink>
        ))}
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>Job status</h2>
          <button onClick={refresh}>Refresh status</button>
        </div>

        <p>
          Read-only status. Manual sends are available only on
          Trade Confirmation and Portfolio.
        </p>

        <Table
          rows={jobs}
          columns={[
            {
              label: 'Job',
              render: row => row.name
            },
            {
              label: 'State',
              render: row => row.running ? 'Running' : 'Idle'
            },
            {
              label: 'Interval',
              render: row => `${row.intervalMs / 60000} min`
            },
            {
              label: 'Last run',
              render: row => dateText(row.at)
            },
            {
              label: 'Last error',
              render: row => row.error || '—'
            }
          ]}
        />
      </section>
    </>
  );
}

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    setError('');

    const results = await Promise.allSettled([
      request('/routes'),
      request('/jobs/status')
    ]);

    if (results[0].status === 'fulfilled') {
      setRoutes(results[0].value.routes || []);
    } else {
      setRoutes([]);
      setError(results[0].reason.message);
    }

    if (results[1].status === 'fulfilled') {
      setJobs(results[1].value.jobs || []);
    } else {
      setJobs([]);
      setError(results[1].reason.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <BrowserRouter>
      <div className="shell">
        <aside>
          <div className="brand">
            <span className="brand-mark">C</span>

            <div>
              CITY BROKERAGE
              <small>Statement Sender</small>
            </div>
          </div>

          <div className="nav-label">WORKSPACE</div>

          <nav>
            <NavLink to="/" end>
              Overview
            </NavLink>

            {modules.map(module => (
              <NavLink
                key={module.type}
                to={`/modules/${module.slug}`}
              >
                {module.name}
              </NavLink>
            ))}

            <NavLink to="/logs">Access Logs</NavLink>
            <NavLink to="/reports">Daily Report</NavLink>
          </nav>

          <div className="sidebar-footer">
            IT / Admin workspace
            <br />
            <span>No login required</span>
          </div>
        </aside>

        <div className="content">
          <header>
            <span>Operations Portal</span>

            <div>
              <span className="badge">{environment}</span>
              <button onClick={refresh}>Refresh API</button>
            </div>
          </header>

          <main>
            <Routes>
              <Route
                path="/"
                element={
                  <Dashboard
                    routes={routes}
                    jobs={jobs}
                    refresh={refresh}
                    error={error}
                  />
                }
              />

              <Route
                path="/modules/:slug"
                element={<ModulePage routes={routes} />}
              />

              <Route
                path="/logs"
                element={<Logs routes={routes} />}
              />

              <Route
                path="/reports"
                element={<Logs routes={routes} daily />}
              />

              <Route
                path="*"
                element={
                  <>
                    <h1>Page not found</h1>
                    <NavLink to="/">Return to overview</NavLink>
                  </>
                }
              />
            </Routes>
          </main>

          <footer>
            City Brokerage Limited · Statement operations
          </footer>
        </div>
      </div>
    </BrowserRouter>
  );
}
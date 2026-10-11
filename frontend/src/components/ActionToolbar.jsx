import React, { useRef, useState } from 'react';
import { request, csvDownload } from '../services/api';
import {
  uniqueTargets,
  sendNotification,
  validSchedule
} from '../services/operations';

export default function ActionToolbar({
  module,
  routes,
  rows,
  busy,
  setBusy,
  operationLock,
  setError,
  setMessage,
  reload
}) {
  const schedule = module.scheduleId;

  const [investor, setInvestor] = useState('');
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [commandResult, setCommandResult] = useState(null);

  const cancel = useRef(false);

  const supports = (method, path) =>
    routes.some(
      route =>
        route.method === method &&
        route.path === `/api${path}`
    );

  const generate = '/portfoliomap/generate';
  const copy = `${module.prefix}/copy-pdfs`;

  const canGenerate = supports('GET', generate);
  const targets = uniqueTargets(rows);

  async function command(action) {
    if (operationLock.current) {
      return;
    }

    let id;

    try {
      if (action !== 'one') {
        id = validSchedule(schedule);
      }

      if (action === 'one' && !investor.trim()) {
        throw new Error(
          'Enter an investor code to generate one URL.'
        );
      }
    } catch (error) {
      setError(error.message);
      return;
    }

    const label =
      action === 'copy'
        ? `Copy today's ${module.name} PDFs for schedule ${id}`
        : action === 'one'
          ? `Generate a new URL for investor ${investor.trim()}`
          : `Generate URLs for schedule ${id}`;

    if (!window.confirm(`${label}?`)) {
      return;
    }

    operationLock.current = true;

    setBusy(true);
    setError('');
    setMessage('');
    setCommandResult(null);

    try {
      const data =
        action === 'one'
          ? await request(
              generate,
              {},
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  code: investor.trim()
                })
              }
            )
          : await request(
              action === 'copy' ? copy : generate,
              {
                scheduleID: id
              },
              {
                method: action === 'copy' ? 'POST' : 'GET'
              }
            );

      setCommandResult(data);

      if (
        action === 'copy' &&
        (
          data.errors?.length ||
          data.missing?.length ||
          !data.copied?.length
        )
      ) {
        setError(
          data.message ||
          'Copy operation completed with missing files or errors. Review the result.'
        );
      } else {
        setMessage(
          data.message ||
          (
            action === 'one'
              ? `URL generated for ${data.code}.`
              : `${data.count ?? 0} URLs generated.`
          )
        );
      }

      if (action !== 'copy') {
        await reload();
      }
    } catch (error) {
      setError(error.message);
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  async function bulk(via) {
    if (operationLock.current || !targets.length) {
      return;
    }

    const channel =
      via === 'mobile'
        ? 'WhatsApp with SMS fallback'
        : via === 'email'
          ? 'email'
          : 'mobile and email';

    const confirmed = window.confirm(
      `Send ${module.name} via ${channel} to ${targets.length} unique investors from ALL loaded rows, including other table pages? ${rows.length - targets.length} duplicate or empty codes are excluded. The backend uses each investor's latest mapping and configured recipients, including test overrides.`
    );

    if (!confirmed) {
      return;
    }

    operationLock.current = true;
    cancel.current = false;

    setBusy(true);
    setError('');
    setMessage('');
    setResults([]);

    const completed = [];

    setProgress({
      done: 0,
      total: targets.length,
      running: true
    });

    try {
      for (const row of targets) {
        if (cancel.current) {
          break;
        }

        try {
          const channels = await sendNotification(
            module,
            row.investorCode,
            via
          );

          completed.push({
            investorCode: row.investorCode,
            via,
            status: 'sent',
            channels,
            error: ''
          });
        } catch (error) {
          completed.push({
            investorCode: row.investorCode,
            via,
            status: 'error',
            channels: '',
            error: error.message
          });
        }

        setResults([...completed]);

        setProgress({
          done: completed.length,
          total: targets.length,
          running: true
        });
      }

      const failed = completed.filter(
        result => result.status === 'error'
      ).length;

      setMessage(
        `${cancel.current ? 'Stopped' : 'Finished'}: ${completed.length - failed} successful, ${failed} with errors, ${targets.length - completed.length} not attempted. Review errors before retrying; partial delivery may have occurred.`
      );
    } finally {
      setProgress({
        done: completed.length,
        total: targets.length,
        running: false
      });

      operationLock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Action commands</h2>

      <div className="filters command-controls">
        <label>
          Schedule
          <input
            type="text"
            value={module.name}
            disabled
          />
        </label>

        {canGenerate && (
          <button
            disabled={busy}
            onClick={() => command('all')}
          >
            Generate schedule URLs
          </button>
        )}

        {supports('POST', copy) && (
          <button
            disabled={busy}
            onClick={() => command('copy')}
          >
            Copy today's PDFs
          </button>
        )}

        {supports('POST', generate) && (
          <>
            <label>
              Investor code
              <input
                value={investor}
                disabled={busy}
                onChange={event =>
                  setInvestor(event.target.value)
                }
                placeholder="Generate one URL"
              />
            </label>

            <button
              disabled={busy || !investor.trim()}
              onClick={() => command('one')}
            >
              Generate one URL
            </button>
          </>
        )}
      </div>

      <p className="subtitle">
        Schedule commands use the backend's current-day rules.
        Changing the report search date does not change the copy date.
      </p>

      {supports('GET', module.notify) && (
        <div className="actions bulk-actions">
          <button
            disabled={busy || !targets.length}
            onClick={() => bulk('mobile')}
          >
            Send all WhatsApp / SMS
          </button>

          <button
            disabled={busy || !targets.length}
            onClick={() => bulk('email')}
          >
            Send all email
          </button>

          <button
            disabled={busy || !targets.length}
            onClick={() => bulk('all')}
          >
            Send all mobile + email
          </button>

          {progress?.running && (
            <button
              onClick={() => {
                cancel.current = true;
              }}
            >
              Stop after current investor
            </button>
          )}

          {!!results.length && (
            <button
              disabled={busy}
              onClick={() =>
                csvDownload(
                  results,
                  `${module.slug}-send-results.csv`
                )
              }
            >
              Export send results
            </button>
          )}
        </div>
      )}

      {progress && (
        <p role="status">
          Processed {progress.done} of {progress.total} investors
          {progress.running ? '…' : '.'}
        </p>
      )}

      {!!results.length && (
        <details>
          <summary>
            Per-investor send results ({results.length})
          </summary>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Investor</th>
                  <th>Status</th>
                  <th>Channels</th>
                  <th>Error</th>
                </tr>
              </thead>

              <tbody>
                {results.map(result => (
                  <tr key={result.investorCode}>
                    <td>{result.investorCode}</td>
                    <td>{result.status}</td>
                    <td>{result.channels || '—'}</td>
                    <td>{result.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {commandResult && (
        <details open>
          <summary>Command result</summary>

          <pre className="command-result">
            {JSON.stringify(commandResult, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
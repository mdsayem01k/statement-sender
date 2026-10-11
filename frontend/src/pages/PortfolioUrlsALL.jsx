import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import '../CSS/ClientLogSearch.css';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

if (!API_BASE) {
  console.error('[Config] VITE_API_BASE is not set - check your .env file.');
}

// ---------------------------------------------------------------------------
// GLOBAL SWITCH: 1 = "Send SMS", "Send Mail" and "Send All Mail" are enabled
//                anything else (0) = they are disabled
// ---------------------------------------------------------------------------
const SEND_ENABLED = 0;
const SENDING_ALLOWED = SEND_ENABLED === 1;
const SENDING_DISABLED_TITLE = 'Sending is currently disabled';

const PAGE_SIZE = 20;
const SEND_TIMEOUT_MS = 30000;
const BULK_MAIL_CONCURRENCY = 3;
const FEEDBACK_MS = 3000;
const COPY_FEEDBACK_MS = 2000;

function getTodayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function toAbsoluteUrl(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : ('http://' + url);
}

async function fetchJson(url, options, timeoutMs) {
  options = options || {};
  timeoutMs = timeoutMs || 0;
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    let data = {};
    try {
      data = (await res.json()) || {};
    } catch (parseErr) {
      // non-JSON body - leave data as {}
    }
    return { res: res, data: data };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The request timed out.');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requestSmsConfirmation(investorCode) {
  const result = await fetchJson(
    API_BASE + '/api/send?code=' + encodeURIComponent(investorCode),
    {},
    SEND_TIMEOUT_MS
  );
  const res = result.res;
  const data = result.data;
  if (!res.ok || !data.success) {
    throw new Error(data.message || ('Failed to send SMS (HTTP ' + res.status + ').'));
  }
  return data;
}

async function requestTradeConfirmation(investorCode) {
  const result = await fetchJson(
    API_BASE + '/api/mail/trade-confirmation?code=' + encodeURIComponent(investorCode),
    {},
    SEND_TIMEOUT_MS
  );
  const res = result.res;
  const data = result.data;
  if (!res.ok || !data.success) {
    throw new Error(data.message || ('Failed to send mail (HTTP ' + res.status + ').'));
  }
  return data;
}

function getBulkTargets(rows) {
  const byCode = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.investorCode && !byCode.has(r.investorCode)) byCode.set(r.investorCode, r);
  }
  const targets = Array.from(byCode.values());
  return { targets: targets, skipped: rows.length - byCode.size };
}

function getPageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, function (_, i) { return i + 1; });
  const items = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) items.push('...');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < total - 1) items.push('...');
  items.push(total);
  return items;
}

function statusStyle(state, opts) {
  opts = opts || {};
  const padX = opts.padX || 14;
  const duration = opts.duration || '0.9s';
  const isSent = state === 'sent';
  const isError = state === 'error';
  return {
    padding: '4px ' + padX + 'px',
    fontSize: '12px',
    backgroundColor: isSent ? '#10B981' : (isError ? '#EF4444' : 'transparent'),
    color: (isSent || isError) ? '#ffffff' : 'inherit',
    borderColor: isSent ? '#10B981' : (isError ? '#EF4444' : '#AA0000'),
    transition: 'all ' + duration + ' ease-in-out'
  };
}

function AlertModal(props) {
  const open = props.open;
  const tone = props.tone || 'info';
  const title = props.title;
  const message = props.message;
  const onClose = props.onClose;
  const onConfirm = props.onConfirm;
  const confirmLabel = props.confirmLabel || 'Confirm';
  const cancelLabel = props.cancelLabel || 'Cancel';

  useEffect(function () {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return function () {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const toneColor =
    tone === 'success' ? '#10B981' :
    tone === 'warning' ? '#F59E0B' :
    tone === 'error' ? '#EF4444' :
    '#AA0000';

  const isConfirm = typeof onConfirm === 'function';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '420px',
          width: '90%',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          borderTop: '4px solid ' + toneColor
        }}
      >
        <h3 id="alert-modal-title" style={{ margin: '0 0 12px 0', color: toneColor }}>
          {title}
        </h3>
        <p style={{ margin: '0 0 20px 0', color: '#333', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {isConfirm && (
            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              autoFocus
              onClick={onClose}
              style={{ padding: '6px 20px' }}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className="cls-btn cls-btn-ghost"
            autoFocus={!isConfirm}
            onClick={isConfirm ? onConfirm : onClose}
            style={{
              backgroundColor: toneColor,
              color: '#fff',
              borderColor: toneColor,
              padding: '6px 24px'
            }}
          >
            {isConfirm ? confirmLabel : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioUrls() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);

  const [dateFilter, setDateFilter] = useState(getTodayDateString());
  const [showAllDates, setShowAllDates] = useState(false);

  // All per-row state is keyed by row._id (unique per row), NOT by investorCode,
  // so rows that share the same investor code no longer affect each other.
  const [copiedKey, setCopiedKey] = useState(null);
  const [smsStatus, setSmsStatus] = useState({});
  const [mailStatus, setMailStatus] = useState({});
  const [sendingAllMail, setSendingAllMail] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  const [alertModal, setAlertModal] = useState({
    open: false,
    tone: 'info',
    title: '',
    message: '',
    onConfirm: null,
    confirmLabel: 'Confirm'
  });

  const closeAlertModal = useCallback(function () {
    setAlertModal(function (prev) {
      return Object.assign({}, prev, { open: false });
    });
  }, []);

  const showAlert = useCallback(function (tone, title, message) {
    setAlertModal({ open: true, tone: tone, title: title, message: message, onConfirm: null, confirmLabel: 'Confirm' });
  }, []);

  const showConfirm = useCallback(function (tone, title, message, onConfirm, confirmLabel) {
    setAlertModal({
      open: true,
      tone: tone,
      title: title,
      message: message,
      onConfirm: onConfirm,
      confirmLabel: confirmLabel || 'Confirm'
    });
  }, []);

  const isMountedRef = useRef(true);
  const statusTimersRef = useRef({});
  const copyTimerRef = useRef(null);
  // Synchronous lock: blocks double-clicks / repeat sends for the same
  // investor code while a request is still running (state updates are async,
  // a ref is immediate).
  const inFlightRef = useRef(new Set());

  useEffect(function () {
    isMountedRef.current = true;
    const timers = statusTimersRef.current;
    return function () {
      isMountedRef.current = false;
      Object.values(timers).forEach(clearTimeout);
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  const setRowStatus = useCallback(function (kind, setter, key, status, autoClearMs) {
    autoClearMs = autoClearMs || 0;
    if (!isMountedRef.current) return;
    const timerKey = kind + ':' + key;
    clearTimeout(statusTimersRef.current[timerKey]);
    setter(function (prev) {
      const next = Object.assign({}, prev);
      next[key] = status;
      return next;
    });
    if (autoClearMs) {
      statusTimersRef.current[timerKey] = setTimeout(function () {
        if (isMountedRef.current) {
          setter(function (prev) {
            const next = Object.assign({}, prev);
            next[key] = null;
            return next;
          });
        }
      }, autoClearMs);
    }
  }, []);

  const loadRows = useCallback(async function () {
    if (!API_BASE) {
      setError('The API address is not configured (VITE_API_BASE). Check your .env file.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (showAllDates) {
        params.set('allDates', 'true');
      } else if (dateFilter) {
        params.set('date', dateFilter);
      }
      const qs = params.toString();
      const url = API_BASE + '/api/report/portfolio-urls' + (qs ? ('?' + qs) : '');

      const result = await fetchJson(url);
      const res = result.res;
      const data = result.data;
      if (!res.ok) {
        throw new Error(data.error || data.message || ('Failed to load portfolio URLs (HTTP ' + res.status + ').'));
      }
      const list = Array.isArray(data.data) ? data.data : [];
      // Give every row a unique id so per-row UI state never collides
      setRows(list.map(function (r, i) { return Object.assign({}, r, { _id: i }); }));
      setSmsStatus({});
      setMailStatus({});
      setCopiedKey(null);
      setPage(1);
    } catch (err) {
      console.error('Load portfolio URLs error:', err);
      setError(
        err instanceof TypeError
          ? 'Could not reach the server. Check your connection and try again.'
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }, [dateFilter, showAllDates]);

  useEffect(function () {
    loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(function () {
    if (!rows) return rows;
    const q = filterText.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (r) {
      return (r.investorCode || '').toLowerCase().indexOf(q) !== -1;
    });
  }, [rows, filterText]);

  useEffect(function () {
    setPage(1);
  }, [filterText]);

  const totalPages = filteredRows ? Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, totalPages);

  const pagedRows = useMemo(function () {
    if (!filteredRows) return filteredRows;
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  const goToPage = function (p) {
    setPage(Math.min(Math.max(1, p), totalPages));
  };

  const copyUrl = async function (url, rowKey) {
    const formattedUrl = toAbsoluteUrl(url);
    if (!formattedUrl) return;

    let success = false;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(formattedUrl);
        success = true;
      } catch (clipErr) {
        // fall through to legacy method
      }
    }

    if (!success) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = formattedUrl;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (err) {
        console.error('Failed to copy link: ', err);
      }
    }

    if (success && isMountedRef.current) {
      clearTimeout(copyTimerRef.current);
      setCopiedKey(rowKey);
      copyTimerRef.current = setTimeout(function () {
        if (isMountedRef.current) setCopiedKey(null);
      }, COPY_FEEDBACK_MS);
    }
  };

  const sendSms = async function (investorCode, rowKey) {
    if (!SENDING_ALLOWED) return;
    if (!investorCode) return;

    const lockKey = 'sms:' + investorCode;
    if (inFlightRef.current.has(lockKey)) return; // already sending for this code
    inFlightRef.current.add(lockKey);

    setRowStatus('sms', setSmsStatus, rowKey, 'sending');
    try {
      await requestSmsConfirmation(investorCode);
      setRowStatus('sms', setSmsStatus, rowKey, 'sent', FEEDBACK_MS);
    } catch (err) {
      console.error('SMS send failed for ' + investorCode + ':', err);
      setRowStatus('sms', setSmsStatus, rowKey, 'error', FEEDBACK_MS);
      showAlert('error', 'SMS Failed', err.message || 'Failed to send SMS.');
    } finally {
      inFlightRef.current.delete(lockKey);
    }
  };

  const sendMailToRow = async function (row, rowKey) {
    if (!SENDING_ALLOWED) return;
    if (!row || !row.investorCode) return;

    const lockKey = 'mail:' + row.investorCode;
    if (inFlightRef.current.has(lockKey)) return;
    inFlightRef.current.add(lockKey);

    setRowStatus('mail', setMailStatus, rowKey, 'sending');
    try {
      await requestTradeConfirmation(row.investorCode);
      setRowStatus('mail', setMailStatus, rowKey, 'sent', FEEDBACK_MS);
    } catch (err) {
      console.error('Mail send failed for ' + row.investorCode + ':', err);
      setRowStatus('mail', setMailStatus, rowKey, 'error', FEEDBACK_MS);
      showAlert('error', 'Email Failed', err.message || 'Failed to send email.');
    } finally {
      inFlightRef.current.delete(lockKey);
    }
  };

  const sendAllMail = async function () {
    if (!SENDING_ALLOWED) return;
    if (!filteredRows || filteredRows.length === 0) return;

    const bulkResult = getBulkTargets(filteredRows);
    const targets = bulkResult.targets;
    const skipped = bulkResult.skipped;

    if (targets.length === 0) {
      showAlert('warning', 'Nothing to Send', 'No rows with a valid investor code were found.');
      return;
    }

    const confirmMessage =
      'This will send trade confirmation emails to ' + targets.length + ' investor' + (targets.length !== 1 ? 's' : '') +
      (skipped > 0 ? (' (' + skipped + ' row' + (skipped !== 1 ? 's' : '') + ' skipped - missing/duplicate code).') : '.') +
      '\n\nThis cannot be undone. Continue?';

    showConfirm(
      'warning',
      'Send All Mail?',
      confirmMessage,
      async function () {
        closeAlertModal();
        if (sendingAllMail) return;
        setSendingAllMail(true);
        setBulkProgress({ done: 0, total: targets.length });

        let doneCount = 0;
        let failCount = 0;
        let index = 0;

        async function worker() {
          while (index < targets.length) {
            const myIndex = index;
            index += 1;
            const row = targets[myIndex];
            const rowKey = row._id;
            const lockKey = 'mail:' + row.investorCode;

            if (inFlightRef.current.has(lockKey)) {
              // a single-row send for this code is already running; don't double send
              doneCount += 1;
              if (isMountedRef.current) {
                setBulkProgress({ done: doneCount, total: targets.length });
              }
              continue;
            }
            inFlightRef.current.add(lockKey);

            setRowStatus('mail', setMailStatus, rowKey, 'sending');
            try {
              await requestTradeConfirmation(row.investorCode);
              setRowStatus('mail', setMailStatus, rowKey, 'sent', FEEDBACK_MS);
            } catch (err) {
              console.error('Bulk mail failed for ' + row.investorCode + ':', err);
              setRowStatus('mail', setMailStatus, rowKey, 'error', FEEDBACK_MS);
              failCount += 1;
            } finally {
              inFlightRef.current.delete(lockKey);
              doneCount += 1;
              if (isMountedRef.current) {
                setBulkProgress({ done: doneCount, total: targets.length });
              }
            }
          }
        }

        const workerCount = Math.min(BULK_MAIL_CONCURRENCY, targets.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
          workers.push(worker());
        }
        await Promise.all(workers);

        if (isMountedRef.current) {
          setSendingAllMail(false);
          const successCount = targets.length - failCount;
          showAlert(
            failCount === 0 ? 'success' : 'warning',
            'Bulk Send Complete',
            'Sent ' + successCount + ' of ' + targets.length + ' email' + (targets.length !== 1 ? 's' : '') + ' successfully.' +
              (failCount > 0 ? ('\n' + failCount + ' failed - check individual rows for details.') : '')
          );
        }
      },
      'Send All'
    );
  };

  const handleDateChange = function (e) {
    setDateFilter(e.target.value);
    setShowAllDates(false);
  };

  const handleTodayClick = function () {
    setDateFilter(getTodayDateString());
    setShowAllDates(false);
  };

  const handleAllDatesToggle = function (e) {
    setShowAllDates(e.target.checked);
  };

  return (
    <div className="cls-page">
      <AlertModal
        open={alertModal.open}
        tone={alertModal.tone}
        title={alertModal.title}
        message={alertModal.message}
        onClose={closeAlertModal}
        onConfirm={alertModal.onConfirm}
        confirmLabel={alertModal.confirmLabel}
      />

      <header className="cls-header">
        <div className="cls-header-inner">
          <div className="cls-brand">
            <span className="cls-brand-mark">CBL</span>
            <span className="cls-brand-name">Portfolio Document URLs</span>
          </div>
          <p className="cls-header-sub">
            All investor document links. Filter by date or investor code.
          </p>
        </div>
      </header>

      <main className="cls-main">
        <form className="cls-search" onSubmit={function (e) { e.preventDefault(); }}>
          <div className="cls-field">
            <label htmlFor="dateFilter">Date</label>
            <input
              id="dateFilter"
              type="date"
              value={dateFilter}
              onChange={handleDateChange}
              disabled={showAllDates}
              max={getTodayDateString()}
            />
          </div>

          <div className="cls-field" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              id="showAllDates"
              type="checkbox"
              checked={showAllDates}
              onChange={handleAllDatesToggle}
            />
            <label htmlFor="showAllDates" style={{ margin: 0 }}>All dates</label>
          </div>

          <div className="cls-field">
            <label htmlFor="investorFilter">Investor code</label>
            <input
              id="investorFilter"
              type="text"
              placeholder="e.g. 0033"
              value={filterText}
              onChange={function (e) { setFilterText(e.target.value); }}
              autoComplete="off"
            />
          </div>

          <div className="cls-actions">
            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={handleTodayClick}
              disabled={loading || (!showAllDates && dateFilter === getTodayDateString())}
            >
              Today
            </button>
            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={function () { setFilterText(''); }}
              disabled={loading || !filterText}
            >
              Clear
            </button>
            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={sendAllMail}
              disabled={!SENDING_ALLOWED || loading || sendingAllMail || !filteredRows || filteredRows.length === 0}
              title={SENDING_ALLOWED ? 'Send trade confirmation email to every filtered row' : SENDING_DISABLED_TITLE}
              style={!SENDING_ALLOWED ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {sendingAllMail ? ('Sending ' + bulkProgress.done + '/' + bulkProgress.total + '...') : 'Send All Mail'}
            </button>
          </div>
        </form>

        {!SENDING_ALLOWED && (
          <div className="cls-alert" role="status">
            SMS and email sending is currently disabled.
          </div>
        )}

        {error && <div className="cls-alert" role="alert">{error}</div>}

        {!loading && !error && rows && (
          <div className="cls-toolbar">
            <div className="cls-summary">
              <span>
                <strong>{filteredRows.length}</strong> of {rows.length} record{rows.length !== 1 ? 's' : ''}
                {' - '}
                {showAllDates ? 'all dates' : dateFilter}
              </span>
            </div>
          </div>
        )}

        {loading && (
          <div className="cls-hint"><p>Loading portfolio URLs...</p></div>
        )}

        {!loading && !error && filteredRows && filteredRows.length === 0 && (
          <div className="cls-empty">
            <p>No matching links found.</p>
            <span>Try a different date, clear the code filter, or check "All dates".</span>
          </div>
        )}

        {!loading && pagedRows && pagedRows.length > 0 && (
          <React.Fragment>
            <div className="cls-table-wrap">
              <table className="cls-table">
                <colgroup>
                  <col style={{ width: '140px' }} />
                  <col style={{ width: 'auto' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '110px' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Investor code</th>
                    <th>Document URL</th>
                    <th>Send SMS</th>
                    <th>Send Mail</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map(function (row) {
                    const rowKey = row._id; // unique per row
                    const isCopied = copiedKey === rowKey;
                    const smsState = smsStatus[rowKey];
                    const mailState = mailStatus[rowKey];
                    const hasUrl = Boolean(row.url);

                    return (
                      <tr key={rowKey}>
                        <td>
                          <span className="cls-mono">
                            {row.investorCode ? row.investorCode : '\u2014'}
                          </span>
                        </td>
                        <td>
                          {hasUrl ? (
                            <a
                              className="cls-mono"
                              href={toAbsoluteUrl(row.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={row.url}
                              style={{ color: 'var(--cbl-red)', textDecoration: 'none' }}
                            >
                              {row.url}
                            </a>
                          ) : (
                            <span className="cls-mono" style={{ color: '#999' }}>
                              {'\u2014'}
                            </span>
                          )}
                        </td>

                        <td>
                          <button
                            type="button"
                            className="cls-btn cls-btn-ghost"
                            disabled={!SENDING_ALLOWED || smsState === 'sending' || sendingAllMail || !row.investorCode}
                            title={!SENDING_ALLOWED ? SENDING_DISABLED_TITLE : undefined}
                            style={Object.assign(
                              {},
                              statusStyle(smsState),
                              !SENDING_ALLOWED ? { opacity: 0.5, cursor: 'not-allowed' } : {}
                            )}
                            onClick={function () { sendSms(row.investorCode, rowKey); }}
                          >
                            {smsState === 'sending' && 'Sending...'}
                            {smsState === 'sent' && 'Sent'}
                            {smsState === 'error' && 'Failed'}
                            {!smsState && 'Send SMS'}
                          </button>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="cls-btn cls-btn-ghost"
                            disabled={!SENDING_ALLOWED || mailState === 'sending' || sendingAllMail || !row.investorCode}
                            title={SENDING_ALLOWED ? 'Email the trade confirmation to this investor' : SENDING_DISABLED_TITLE}
                            style={Object.assign(
                              {},
                              statusStyle(mailState),
                              { opacity: (!SENDING_ALLOWED || !row.investorCode) ? 0.5 : 1 },
                              !SENDING_ALLOWED ? { cursor: 'not-allowed' } : {}
                            )}
                            onClick={function () { sendMailToRow(row, rowKey); }}
                          >
                            {mailState === 'sending' && 'Sending...'}
                            {mailState === 'sent' && 'Sent'}
                            {mailState === 'error' && 'Failed'}
                            {!mailState && 'Send Mail'}
                          </button>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="cls-btn cls-btn-ghost"
                            disabled={!hasUrl}
                            style={Object.assign(
                              {},
                              statusStyle(isCopied ? 'sent' : null, { padX: 20, duration: '0.8s' }),
                              { opacity: !hasUrl ? 0.5 : 1 }
                            )}
                            onClick={function () { copyUrl(row.url, rowKey); }}
                          >
                            {isCopied ? 'Copied' : 'Copy'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div
                className="cls-pagination"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '16px',
                  flexWrap: 'wrap'
                }}
              >
                <button
                  type="button"
                  className="cls-btn cls-btn-ghost"
                  onClick={function () { goToPage(currentPage - 1); }}
                  disabled={currentPage === 1}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Prev
                </button>

                {getPageItems(currentPage, totalPages).map(function (item, i) {
                  if (item === '...') {
                    return (
                      <span key={'gap-' + i} style={{ padding: '0 4px', color: '#666' }}>...</span>
                    );
                  }
                  return (
                    <button
                      key={item}
                      type="button"
                      className="cls-btn cls-btn-ghost"
                      onClick={function () { goToPage(item); }}
                      aria-current={item === currentPage ? 'page' : undefined}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: item === currentPage ? '#AA0000' : 'transparent',
                        color: item === currentPage ? '#ffffff' : 'inherit',
                        borderColor: '#AA0000',
                        minWidth: '32px'
                      }}
                    >
                      {item}
                    </button>
                  );
                })}

                <button
                  type="button"
                  className="cls-btn cls-btn-ghost"
                  onClick={function () { goToPage(currentPage + 1); }}
                  disabled={currentPage === totalPages}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Next
                </button>

                <span style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                  Page {currentPage} of {totalPages}
                </span>
              </div>
            )}
          </React.Fragment>
        )}
      </main>
    </div>
  );
}
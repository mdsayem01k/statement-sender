import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import '../CSS/Clientlogsearch.css'; // reuses the same CBL-branded styles

// Trailing slashes stripped so `${API_BASE}/api/...` never becomes "//api/..."
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

if (!API_BASE) {
  console.error('[Config] VITE_API_BASE is not set — check your .env file.');
}

const DEFAULT_SCHEDULE_ID = 2;
const PAGE_SIZE = 20;
const SEND_TIMEOUT_MS = 30000; // per SMS / mail request
const BULK_MAIL_CONCURRENCY = 3; // parallel mail requests during "Send All Mail"
const FEEDBACK_MS = 3000; // how long Sent ✓ / Failed ✕ stays on a button
const COPY_FEEDBACK_MS = 2000;

// Normalize a possibly-missing URL to an absolute http(s) URL.
function toAbsoluteUrl(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `http://${url}`;
}

// fetch + safe JSON parsing. A non-JSON body (e.g. an HTML 502 page from a proxy)
// no longer throws a confusing "Unexpected token <" error; callers just check res.ok.
// timeoutMs = 0 means no timeout (used for long-running jobs like Copy PDFs).
async function fetchJson(url, options = {}, timeoutMs = 0) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let data = {};
    try {
      data = (await res.json()) || {};
    } catch {
      // non-JSON body — leave data as {}
    }
    return { res, data };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The request timed out.');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Calls the BO backend, which looks up the investor's email, builds the
// trade-confirmation link and forwards to the mail API. The browser never talks
// to the mail server directly.
async function requestTradeConfirmation(investorCode) {
  const { res, data } = await fetchJson(
    `${API_BASE}/api/mail/trade-confirmation?code=${encodeURIComponent(investorCode)}`,
    {},
    SEND_TIMEOUT_MS
  );
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Failed to send mail (HTTP ${res.status}).`);
  }
  return data;
}

// One row per investor code — skips rows without a code and duplicate codes
// (the endpoint is keyed by code, so duplicates would send the same email twice).
function getBulkTargets(rows) {
  const byCode = new Map();
  for (const r of rows) {
    if (r.investorCode && !byCode.has(r.investorCode)) byCode.set(r.investorCode, r);
  }
  return { targets: [...byCode.values()], skipped: rows.length - byCode.size };
}

// Windowed page list: 1 … 4 5 [6] 7 8 … 40 instead of 40 buttons in a row.
function getPageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) items.push('…');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
}

// Shared style for the SMS / Mail / Copy buttons.
// White text only for sent/error — the old code also turned text white while
// "sending", which made "Sending…" invisible on a transparent background.
function statusStyle(state, { padX = 14, duration = '0.9s' } = {}) {
  const isSent = state === 'sent';
  const isError = state === 'error';
  return {
    padding: `4px ${padX}px`,
    fontSize: '12px',
    backgroundColor: isSent ? '#10B981' : isError ? '#EF4444' : 'transparent',
    color: isSent || isError ? '#ffffff' : 'inherit',
    borderColor: isSent ? '#10B981' : isError ? '#EF4444' : '#AA0000',
    transition: `all ${duration} ease-in-out`,
  };
}

// Blocking modal. With `onConfirm` it becomes a Cancel / Confirm dialog.
function AlertModal({
  open,
  tone = 'info',
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
        zIndex: 1000,
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
          borderTop: `4px solid ${toneColor}`,
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
              padding: '6px 24px',
            }}
          >
            {isConfirm ? confirmLabel : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BoPage() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);

  const [copiedKey, setCopiedKey] = useState(null);
  const [smsStatus, setSmsStatus] = useState({}); // { [rowKey]: 'sending' | 'sent' | 'error' | null }
  const [mailStatus, setMailStatus] = useState({}); // same shape
  const [generating, setGenerating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sendingAllMail, setSendingAllMail] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  const [alertModal, setAlertModal] = useState({
    open: false,
    tone: 'info',
    title: '',
    message: '',
    onConfirm: null,
    confirmLabel: 'Confirm',
  });

  const closeAlertModal = useCallback(
    () => setAlertModal((prev) => ({ ...prev, open: false })),
    []
  );

  const showAlert = useCallback(
    (tone, title, message) =>
      setAlertModal({ open: true, tone, title, message, onConfirm: null, confirmLabel: 'Confirm' }),
    []
  );

  // Guards against setState after unmount, and holds every pending feedback timer
  // so they can be cleared on unmount.
  const isMountedRef = useRef(true);
  const statusTimersRef = useRef({});
  const copyTimerRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    const timers = statusTimersRef.current;
    return () => {
      isMountedRef.current = false;
      Object.values(timers).forEach(clearTimeout);
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Sets a per-row status and (optionally) clears it after autoClearMs.
  // The previous timer for the same row is cancelled first, so an old "Sent ✓"
  // timeout can't wipe out a newer "Sending…" state.
  const setRowStatus = useCallback((kind, setter, key, status, autoClearMs = 0) => {
    if (!isMountedRef.current) return;
    const timerKey = `${kind}:${key}`;
    clearTimeout(statusTimersRef.current[timerKey]);
    setter((prev) => ({ ...prev, [key]: status }));
    if (autoClearMs) {
      statusTimersRef.current[timerKey] = setTimeout(() => {
        if (isMountedRef.current) setter((prev) => ({ ...prev, [key]: null }));
      }, autoClearMs);
    }
  }, []);

  // Fetch the full list — used on mount and after a successful generate.
  const loadRows = useCallback(async () => {
    if (!API_BASE) {
      setError('The API address is not configured (VITE_API_BASE). Check your .env file.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { res, data } = await fetchJson(`${API_BASE}/api/report/portfolio-urls`);
      if (!res.ok) {
        throw new Error(
          data.error || data.message || `Failed to load BO URLs (HTTP ${res.status}).`
        );
      }
      setRows(Array.isArray(data.data) ? data.data : []);
      setPage(1);
    } catch (err) {
      console.error('Load BO URLs error:', err);
      // fetch() network failures surface as TypeError; anything else has a real message.
      setError(
        err instanceof TypeError
          ? 'Could not reach the server. Check your connection and try again.'
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Client-side filter against the already-fetched rows.
  const filteredRows = useMemo(() => {
    if (!rows) return rows;
    const q = filterText.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.investorCode || '').toLowerCase().includes(q));
  }, [rows, filterText]);

  useEffect(() => {
    setPage(1);
  }, [filterText]);

  const totalPages = filteredRows ? Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, totalPages);

  const pagedRows = useMemo(() => {
    if (!filteredRows) return filteredRows;
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  const goToPage = (p) => setPage(Math.min(Math.max(1, p), totalPages));

  // Copy link handler with HTTP/IP support
  const copyUrl = async (url, rowKey) => {
    const formattedUrl = toAbsoluteUrl(url);
    if (!formattedUrl) return;

    let success = false;

    // 1. Modern API (HTTPS / localhost)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(formattedUrl);
        success = true;
      } catch {
        // fall through to legacy method
      }
    }

    // 2. Legacy fallback (works over HTTP / IP / mobile)
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
      clearTimeout(copyTimerRef.current); // clicking Copy on another row must not be cut short
      setCopiedKey(rowKey);
      copyTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setCopiedKey(null);
      }, COPY_FEEDBACK_MS);
    }
  };

  // Send SMS
  const sendSms = async (investorCode, rowKey) => {
    if (!investorCode) return;

    setRowStatus('sms', setSmsStatus, rowKey, 'sending');
    try {
      const { res, data } = await fetchJson(
        `${API_BASE}/api/send?code=${encodeURIComponent(investorCode)}`,
        {},
        SEND_TIMEOUT_MS
      );
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to send SMS');
      }
      setRowStatus('sms', setSmsStatus, rowKey, 'sent', FEEDBACK_MS);
    } catch (err) {
      console.error('SMS trigger error:', err);
      setRowStatus('sms', setSmsStatus, rowKey, 'error', FEEDBACK_MS);
    }
  };

  // Generate URLs — refreshes the table, then shows the result in a blocking modal.
  const generateUrls = async () => {
    setGenerating(true);
    try {
      const { res, data } = await fetchJson(
        `${API_BASE}/api/portfoliomap/generate?scheduleID=${DEFAULT_SCHEDULE_ID}`
      );
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to generate URL(s).');
      }

      await loadRows();

      showAlert(
        'success',
        'URLs Generated',
        `Generated ${data.count} URL${data.count !== 1 ? 's' : ''} for scheduleID=${DEFAULT_SCHEDULE_ID}.`
      );
    } catch (err) {
      console.error('Generate URL error:', err);
      showAlert('error', 'Generate Failed', err.message || 'Failed to generate URL(s).');
    } finally {
      if (isMountedRef.current) setGenerating(false);
    }
  };

  // Copy PDFs — no client timeout: copying from a network drive can take a while.
  const copyPdfs = async () => {
    setCopying(true);
    try {
      const { res, data } = await fetchJson(
        `${API_BASE}/api/report/copy-pdfs?scheduleID=${DEFAULT_SCHEDULE_ID}`,
        { method: 'POST' }
      );

      if (res.status === 409 || data.matched === false) {
        showAlert(
          'warning',
          'Count Mismatch',
          data.message ||
            `Expected ${data.expectedCount} PDF(s) but found ${data.sourceCount} on the network drive. No files were copied.`
        );
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to copy PDFs.');
      }

      showAlert('success', 'PDFs Copied', data.message || `Copied ${data.copied?.length ?? 0} PDF(s).`);
    } catch (err) {
      console.error('Copy PDFs error:', err);
      showAlert('error', 'Copy Failed', err.message || 'Failed to copy PDFs.');
    } finally {
      if (isMountedRef.current) setCopying(false);
    }
  };

  // Send Mail (one investor). The server resolves the email address, so nothing
  // is gated on an email field in the row.
  const sendMailToRow = async (row, rowKey) => {
    if (!row.investorCode) return;

    setRowStatus('mail', setMailStatus, rowKey, 'sending');
    try {
      await requestTradeConfirmation(row.investorCode);
      setRowStatus('mail', setMailStatus, rowKey, 'sent', FEEDBACK_MS);
    } catch (err) {
      console.error('Send mail error:', err);
      setRowStatus('mail', setMailStatus, rowKey, 'error', FEEDBACK_MS);
      showAlert('error', 'Mail Failed', `Could not send mail for investor ${row.investorCode}: ${err.message}`);
    }
  };

  // Send All Mail — runs after the user confirms. Sends one request per investor
  // with limited concurrency, updating each row's button and a progress counter.
  const sendAllMail = async (targets, skipped) => {
    setSendingAllMail(true);
    setBulkProgress({ done: 0, total: targets.length });

    let cursor = 0;
    let sent = 0;
    const failures = [];

    const worker = async () => {
      while (isMountedRef.current) {
        const row = targets[cursor++];
        if (!row) return;

        const key = row.investorCode;
        setRowStatus('mail', setMailStatus, key, 'sending');
        try {
          await requestTradeConfirmation(row.investorCode);
          sent += 1;
          setRowStatus('mail', setMailStatus, key, 'sent', FEEDBACK_MS);
        } catch (err) {
          failures.push({ code: row.investorCode, message: err.message });
          setRowStatus('mail', setMailStatus, key, 'error', FEEDBACK_MS);
        }
        setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(BULK_MAIL_CONCURRENCY, targets.length) }, () => worker())
      );
    } finally {
      if (isMountedRef.current) setSendingAllMail(false);
    }

    if (!isMountedRef.current) return;

    const parts = [`Sent ${sent} of ${targets.length} email(s).`];
    if (failures.length > 0) {
      const codes = failures.slice(0, 5).map((f) => f.code).join(', ');
      parts.push(`${failures.length} failed (${codes}${failures.length > 5 ? ', …' : ''}).`);
      parts.push(`First error: ${failures[0].message}`);
    }
    if (skipped > 0) {
      parts.push(`${skipped} row(s) skipped — missing or duplicate investor code.`);
    }

    showAlert(
      failures.length === 0 ? 'success' : sent === 0 ? 'error' : 'warning',
      'Bulk Mail Complete',
      parts.join('\n')
    );
  };

  // "Send All Mail" button — always asks first, since this emails every investor
  // in the current (filtered) list.
  const confirmSendAllMail = () => {
    const { targets, skipped } = getBulkTargets(filteredRows || []);

    if (targets.length === 0) {
      showAlert('warning', 'Nothing To Send', 'No rows with an investor code in the current list.');
      return;
    }

    const filter = filterText.trim();
    const n = targets.length;

    setAlertModal({
      open: true,
      tone: 'warning',
      title: 'Send All Mail?',
      message:
        `This will email a trade confirmation to ${n} investor${n !== 1 ? 's' : ''}` +
        `${filter ? ` matching "${filter}"` : ''}. Each investor gets their own email.`,
      confirmLabel: `Send ${n} email${n !== 1 ? 's' : ''}`,
      onConfirm: () => {
        closeAlertModal();
        sendAllMail(targets, skipped);
      },
    });
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
            <span className="cls-brand-name">BO Document URLs</span>
          </div>
          <p className="cls-header-sub">
            All investor document links. Filter by investor code.
          </p>
        </div>
      </header>

      <main className="cls-main">
        <form className="cls-search" onSubmit={(e) => e.preventDefault()}>
          <div className="cls-field">
            <label htmlFor="investorFilter">Investor code</label>
            <input
              id="investorFilter"
              type="text"
              placeholder="e.g. 0033"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="cls-actions">
            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={() => setFilterText('')}
              disabled={loading || !filterText}
            >
              Clear
            </button>

            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={generateUrls}
              disabled={generating}
              style={{ marginLeft: '8px' }}
            >
              {generating ? 'Generating…' : 'Generate URL'}
            </button>

            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={copyPdfs}
              disabled={copying}
              style={{ marginLeft: '8px' }}
            >
              {copying ? 'Copying…' : 'Copy PDFs'}
            </button>

            <button
              type="button"
              className="cls-btn cls-btn-ghost"
              onClick={confirmSendAllMail}
              disabled={sendingAllMail || loading || !filteredRows || filteredRows.length === 0}
              style={{ marginLeft: '8px' }}
              title="Sends each investor in the current list their own trade confirmation email"
            >
              {sendingAllMail
                ? `Sending Mail… ${bulkProgress.done}/${bulkProgress.total}`
                : 'Send All Mail'}
            </button>
          </div>
        </form>

        {error && <div className="cls-alert" role="alert">{error}</div>}

        {!loading && !error && rows && (
          <div className="cls-toolbar">
            <div className="cls-summary">
              <span>
                <strong>{filteredRows.length}</strong> of {rows.length} record{rows.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        )}

        {loading && (
          <div className="cls-hint"><p>Loading BO URLs…</p></div>
        )}

        {!loading && !error && filteredRows && filteredRows.length === 0 && (
          <div className="cls-empty">
            <p>No matching investor codes.</p>
            <span>Try a different code or clear the filter.</span>
          </div>
        )}

        {!loading && pagedRows && pagedRows.length > 0 && (
          <>
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
                  {pagedRows.map((row, idx) => {
                    const absoluteIdx = (currentPage - 1) * PAGE_SIZE + idx;
                    // Fallback key is unique across pages (idx alone repeats on every page)
                    const rowKey = row.investorCode || `row-${absoluteIdx}`;
                    const isCopied = copiedKey === rowKey;
                    const smsState = smsStatus[rowKey];
                    const mailState = mailStatus[rowKey];
                    const hasUrl = Boolean(row.url);

                    return (
                      <tr key={`${absoluteIdx}-${rowKey}`}>
                        <td><span className="cls-mono">{row.investorCode || '—'}</span></td>
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
                            <span className="cls-mono" style={{ color: '#999' }}>—</span>
                          )}
                        </td>

                        {/* Send SMS */}
                        <td>
                          <button
                            type="button"
                            className="cls-btn cls-btn-ghost"
                            disabled={smsState === 'sending' || !row.investorCode}
                            style={statusStyle(smsState)}
                            onClick={() => sendSms(row.investorCode, rowKey)}
                          >
                            {smsState === 'sending' && 'Sending…'}
                            {smsState === 'sent' && 'Sent ✓'}
                            {smsState === 'error' && 'Failed ✕'}
                            {!smsState && 'Send SMS'}
                          </button>
                        </td>

                        {/* Send Mail — disabled while "Send All Mail" runs to avoid duplicate emails */}
                        <td>
                          <button
                            type="button"
                            className="cls-btn cls-btn-ghost"
                            disabled={mailState === 'sending' || sendingAllMail || !row.investorCode}
                            title="Email the trade confirmation to this investor"
                            style={{
                              ...statusStyle(mailState),
                              opacity: !row.investorCode ? 0.5 : 1,
                            }}
                            onClick={() => sendMailToRow(row, rowKey)}
                          >
                            {mailState === 'sending' && 'Sending…'}
                            {mailState === 'sent' && 'Sent ✓'}
                            {mailState === 'error' && 'Failed ✕'}
                            {!mailState && 'Send Mail'}
                          </button>
                        </td>

                        {/* Copy link */}
                        <td>
                          <button
                            type="button"
                            className="cls-btn cls-btn-ghost"
                            disabled={!hasUrl}
                            style={{
                              ...statusStyle(isCopied ? 'sent' : null, { padX: 20, duration: '0.8s' }),
                              opacity: !hasUrl ? 0.5 : 1,
                            }}
                            onClick={() => copyUrl(row.url, rowKey)}
                          >
                            {isCopied ? 'Copied ✓' : 'Copy'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination — 20 rows per page, windowed page numbers */}
            {totalPages > 1 && (
              <div
                className="cls-pagination"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '16px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="cls-btn cls-btn-ghost"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Prev
                </button>

                {getPageItems(currentPage, totalPages).map((item, i) =>
                  item === '…' ? (
                    <span key={`gap-${i}`} style={{ padding: '0 4px', color: '#666' }}>…</span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className="cls-btn cls-btn-ghost"
                      onClick={() => goToPage(item)}
                      aria-current={item === currentPage ? 'page' : undefined}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: item === currentPage ? '#AA0000' : 'transparent',
                        color: item === currentPage ? '#ffffff' : 'inherit',
                        borderColor: '#AA0000',
                        minWidth: '32px',
                      }}
                    >
                      {item}
                    </button>
                  )
                )}

                <button
                  type="button"
                  className="cls-btn cls-btn-ghost"
                  onClick={() => goToPage(currentPage + 1)}
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
          </>
        )}
      </main>
    </div>
  );
}
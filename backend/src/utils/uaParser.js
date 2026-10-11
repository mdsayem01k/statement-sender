/**
 * Lightweight User-Agent parser.
 * No external dependency — good enough for audit-log display purposes.
 * NOTE: user-agent strings are client-supplied and can be spoofed;
 * treat this as informational, not a security signal.
 */

function parseUserAgent(ua) {
  if (!ua || typeof ua !== 'string') {
    return { device: 'Unknown', os: 'Unknown', browser: 'Unknown' };
  }

  let device = 'Desktop';
  if (/iPad/i.test(ua)) {
    device = 'iPad';
  } else if (/iPhone/i.test(ua)) {
    device = 'iPhone';
  } else if (/Android/i.test(ua)) {
    device = /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
  } else if (/Windows Phone/i.test(ua)) {
    device = 'Windows Phone';
  } else if (/Mobile/i.test(ua)) {
    device = 'Mobile';
  }

  let os = 'Unknown';
  if (/Windows NT 10\.0/i.test(ua)) {
    os = 'Windows 10/11';
  } else if (/Windows NT 6\.3/i.test(ua)) {
    os = 'Windows 8.1';
  } else if (/Windows NT/i.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) {
    const m = ua.match(/Mac OS X ([0-9_]+)/);
    os = m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  } else if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([0-9.]+)/);
    os = m ? `Android ${m[1]}` : 'Android';
  } else if (/iPhone OS|CPU OS/i.test(ua)) {
    const m = ua.match(/OS\s([0-9_]+)/);
    os = m ? `iOS ${m[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  let browser = 'Unknown';
  let m;
  if ((m = ua.match(/Edg\/([0-9.]+)/i))) {
    browser = `Edge ${m[1]}`;
  } else if ((m = ua.match(/OPR\/([0-9.]+)/i))) {
    browser = `Opera ${m[1]}`;
  } else if ((m = ua.match(/SamsungBrowser\/([0-9.]+)/i))) {
    browser = `Samsung Internet ${m[1]}`;
  } else if ((m = ua.match(/Firefox\/([0-9.]+)/i))) {
    browser = `Firefox ${m[1]}`;
  } else if ((m = ua.match(/CriOS\/([0-9.]+)/i))) {
    browser = `Chrome (iOS) ${m[1]}`;
  } else if ((m = ua.match(/Chrome\/([0-9.]+)/i))) {
    browser = `Chrome ${m[1]}`;
  } else if (/Safari\//i.test(ua) && (m = ua.match(/Version\/([0-9.]+)/i))) {
    browser = `Safari ${m[1]}`;
  }

  return { device, os, browser };
}

module.exports = { parseUserAgent };
const crypto = require('crypto');

// Short, URL-safe, unguessable code (default 20 chars, mixed-case alphanumeric)
function generateShortUrlCode(code, length = 20) {
  const raw = `${code}${Date.now()}${crypto.randomBytes(16).toString('hex')}`;
  return crypto
    .createHash('sha256').update(raw).digest('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, length);
}

module.exports = { generateShortUrlCode };
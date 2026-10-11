// .env switch: true / 1 / yes / on (any case, spaces and quotes ignored). Anything else = off.
const flag = (v) => /^(true|1|yes|on)$/i.test(String(v ?? '').trim().replace(/^["']|["']$/g, ''));
module.exports = { flag };
 
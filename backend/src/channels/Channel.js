// Base class for one way of reaching an investor (WhatsApp, SMS, Email, ...).
// To add a channel (e.g. Telegram): extend this, then add it to a chain in bootstrap/context.js.
class Channel {
  constructor(name) {
    this.name = name;
  }

  // true if this channel can reach the recipient (valid number / address)
  accepts(/* recipient */) {
    return true;
  }

  // payload = { type, recipient, text, subject, html }
  // must throw an Error when sending fails
  async send(/* payload */) {
    throw new Error(`${this.name}: send() not implemented`);
  }
}

module.exports = Channel;

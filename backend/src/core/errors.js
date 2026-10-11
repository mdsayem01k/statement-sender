class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// auditMessage: detail for the audit log only. publicMessage: text the visitor sees.
class NotFoundError extends HttpError {
  constructor(message, { auditMessage, publicMessage } = {}) {
    super(404, message);
    this.auditMessage = auditMessage;
    this.publicMessage = publicMessage;
  }
}

module.exports = { HttpError, NotFoundError };

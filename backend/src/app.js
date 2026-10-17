const express = require('express');
const cors = require('cors');
const { sendHtmlError } = require('./utils/htmlError');

// registry: a ModuleRegistry. Routes of every module are mounted under /api.
function createApp(registry) {
  const app = express();
  app.use(cors());
  app.use('/api/report/send-batches', express.json({ limit: '2mb' }));
  app.use(express.json());

  const router = express.Router();
  registry.mountRoutes(router);
  app.use('/api', router);

  app.get('/health', (req, res) => res.json({ status: 'UP', message: 'PDF Hosting API is running' }));

  // unknown path
  app.use((req, res) =>
    sendHtmlError(res, 404, 'Not Found', `The requested endpoint <strong>${req.originalUrl}</strong> does not exist on this server.`));

  // unexpected errors (a module handler threw): JSON for API clients, HTML page for browsers
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.statusCode || 500;
    const message = status === 500 ? 'Something went wrong while processing your request.' : err.message;
    if (status === 500) console.error('[ERROR]', req.originalUrl, err);
    if (req.xhr || /json/.test(req.headers.accept || '')) return res.status(status).json({ success: false, message });
    return sendHtmlError(res, status, status === 500 ? 'Internal Server Error' : 'Error', message);
  });

  return app;
}

module.exports = createApp;

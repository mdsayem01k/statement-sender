const fs = require('fs');
const { rejection } = require('./Sender');

function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) throw rejection('Invalid notification ID');
  return number;
}

function routes(service) {
  const repo = service.repository;
  return [
    { method: 'get', path: '/bo/accounts', handler: async (req, res) => {
      await repo.ensureTables();
      const limit = Number(req.query.limit || 25);
      const offset = Number(req.query.offset || 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw rejection('Invalid pagination');
      const data = await repo.list({ limit, offset, q: String(req.query.q || '').trim().slice(0, 50) });
      res.json({ success: true, ...data });
    } },
    { method: 'post', path: '/bo/accounts/sync', handler: async (req, res) => {
      res.json({ success: true, ...(await service.sync()) });
    } },
    { method: 'get', path: '/bo/accounts/:id/preview', handler: async (req, res) => {
      const item = await repo.find(id(req.params.id));
      if (!item) throw rejection('Account not found', 404);
      res.json({ success: true, ...(await service.preview(item)), deliveries: [...await repo.deliveries(item.NotificationID), ...(await repo.legacyDeliveries(item)).map(row => ({ ...row, State: `LEGACY_${row.State}` }))] });
    } },
    { method: 'post', path: '/bo/accounts/:id/send', handler: async (req, res) => {
      const results = await service.send(id(req.params.id), req.body?.hash);
      res.json({ success: true, results });
    } },
    { method: 'get', path: '/BOACK', handler: async (req, res) => {
      const code = String(req.query.BOID || '');
      if (!/^[a-f0-9]{48}$/.test(code)) throw rejection('Invalid acknowledgement link');
      const item = await repo.byUrl(code);
      if (!item) throw rejection('Acknowledgement not found', 404);
      const filename = service.pdfPath(item);
      try {
        if (!(await fs.promises.stat(filename)).isFile()) throw rejection('Acknowledgement PDF is missing', 404);
      } catch (error) {
        if (error.code === 'ENOENT') throw rejection('Acknowledgement PDF is missing', 404);
        throw error;
      }
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Disposition', `inline; filename="${item.InvestorCode}.pdf"`);
      await new Promise((resolve, reject) => res.sendFile(filename, error => error ? reject(error) : resolve()));
      try {
        await service.ctx.audit.save({ encryptoCode: item.URLCode, resolvedCode: item.InvestorCode,
          status: 'BO_ACCOUNT_SUCCESS', statusCode: 200, clientIp: req.ip,
          userAgent: req.headers['user-agent'] });
      } catch (error) { console.error('[BO ACK AUDIT]', error.message); }
    } }
  ];
}

module.exports = routes;

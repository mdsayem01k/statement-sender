const crypto = require('crypto');
const express = require('express');
const VirtualAccountRepository = require('./VirtualAccountRepository');
const page = require('./page');

function sendPage(res, data = {}, status = 200) {
  const nonce = crypto.randomBytes(18).toString('base64');

  res.set(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
  );

  return res
    .status(status)
    .type('html')
    .send(page({ ...data, nonce }));
}

function createRoutes(repository = new VirtualAccountRepository()) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  router.get('/', (req, res) => sendPage(res));

  router.post(
    '/',
    express.urlencoded({
      extended: false,
      limit: '2kb'
    }),
    async (req, res) => {
      const input = req.body?.investorCode;

      const code =
        typeof input === 'string'
          ? input.trim()
          : '';

      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code)) {
        return sendPage(
          res,
          {
            code: code.slice(0, 50),
            error: 'Enter a valid investor code.'
          },
          400
        );
      }

      try {
        const row = await repository.findByCode(code);

        const account =
          row?.accountNumber == null
            ? ''
            : String(row.accountNumber).trim();

        if (!account) {
          return sendPage(
            res,
            {
              code,
              error:
                'No virtual account number is available for this investor code.'
            },
            404
          );
        }

        return sendPage(res, { code, account });
      } catch (error) {
        console.error(
          '[VA LOOKUP]',
          error.code || 'LOOKUP_FAILED'
        );

        return sendPage(
          res,
          {
            code,
            error:
              'Account lookup is temporarily unavailable. Please try again later.'
          },
          503
        );
      }
    }
  );

  return router;
}

module.exports = createRoutes;
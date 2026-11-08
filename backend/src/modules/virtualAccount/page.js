function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page({
  code = '',
  account = null,
  error = '',
  nonce = ''
} = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Virtual Account | City Brokerage Limited</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      font-family: Arial, Helvetica, sans-serif;
      color: #25252c;
      background: #f8f5f4;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 22px max(24px, 6vw);
      background: #bc1531;
      color: white;
    }

    .mark {
      flex: 0 0 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border: 1px solid #ffffff80;
      border-radius: 50%;
      font-size: 25px;
      font-weight: bold;
    }

    .brand {
      font-size: 15px;
      font-weight: bold;
      line-height: 1.5;
    }

    .brand small {
      display: block;
      margin-top: 3px;
      font-size: 10px;
      font-weight: normal;
      letter-spacing: 2px;
    }

    main {
      width: min(100%, 1120px);
      margin: auto;
      padding: 64px 28px;
      display: grid;
      grid-template-columns: 0.85fr 1.15fr;
      align-items: center;
      gap: 50px;
    }

    main > section {
      min-width: 0;
    }

    .eyebrow {
      color: #bc1531;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    h1 {
      margin: 20px 0;
      font-family: Georgia, serif;
      font-size: clamp(36px, 4.8vw, 54px);
      font-weight: normal;
      line-height: 1.15;
    }

    h1 span {
      color: #bc1531;
    }

    .intro {
      color: #68666d;
      line-height: 1.8;
    }

    .card {
      min-width: 0;
      padding: 30px;
      border: 1px solid #e9e1df;
      border-top: 4px solid #bc1531;
      border-radius: 12px;
      background: white;
      box-shadow: 0 15px 45px #25202008;
    }

    h2 {
      margin: 0 0 10px;
      font-size: 21px;
    }

    .description,
    .hint {
      color: #77717a;
      font-size: 13px;
      line-height: 1.65;
    }

    .description {
      margin-bottom: 24px;
    }

    label {
      display: block;
      margin-bottom: 10px;
      font-size: 13px;
      font-weight: bold;
    }

    input {
      width: 100%;
      min-width: 0;
      padding: 14px;
      border: 1px solid #d9d1d2;
      border-radius: 6px;
      background: white;
      color: #25252c;
      font: inherit;
      font-size: 16px;
    }

    input:focus {
      outline: 2px solid #bc1531;
      outline-offset: 2px;
    }

    button {
      min-height: 46px;
      padding: 13px 18px;
      border: 0;
      border-radius: 6px;
      background: #bc1531;
      color: white;
      font: inherit;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
    }

    button:hover {
      background: #9f1028;
    }

    button:focus-visible {
      outline: 3px solid #25252c;
      outline-offset: 3px;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.7;
    }

    .submit {
      width: 100%;
      margin-top: 18px;
    }

    .result {
      min-width: 0;
      margin-top: 26px;
      padding: 20px;
      border: 1px solid #e8b4be;
      border-radius: 8px;
      background: #fff7f8;
    }

    .result h2 {
      margin: 0 0 18px;
      font-size: 20px;
      color: #a2142d;
    }

    .account-name {
      margin: 0 0 14px;
      font-size: 14px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }

    .account-line {
      max-width: 100%;
      overflow-x: auto;
      padding: 4px;
      margin: -4px;
    }

    .account-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: nowrap;
      min-width: max-content;
    }

    .account-row label {
      flex: 0 0 auto;
      margin: 0;
      font-size: 13px;
      white-space: nowrap;
    }

    .account-row input {
      flex: 0 0 auto;
      width: auto;
      padding: 8px 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      font-family: Consolas, monospace;
      font-size: 16px;
      font-weight: bold;
      color: #83162c;
    }

    .account-row button {
    flex: 0 0 auto;
    min-height: 30px;
    padding: 5px 10px;
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
  }

    .copy-status {
      min-height: 18px;
      margin: 12px 0 0;
      color: #7b2639;
      font-size: 12px;
      line-height: 1.5;
    }

    .error {
      margin-top: 22px;
      padding: 14px;
      border: 1px solid #fecdd3;
      border-radius: 6px;
      background: #fff0f2;
      color: #a2142d;
      font-size: 13px;
      line-height: 1.6;
    }

    footer {
      padding: 22px;
      border-top: 1px solid #e9e1df;
      text-align: center;
      color: #827a80;
      font-size: 11px;
      line-height: 1.7;
    }

    @media (max-width: 900px) {
      main {
        grid-template-columns: 1fr;
        gap: 26px;
        max-width: 650px;
        padding: 36px 20px;
      }

      h1 {
        margin: 15px 0;
        font-size: 38px;
      }

      .card {
        padding: 25px;
      }

      .header {
        padding: 18px 20px;
      }
    }

    @media (max-width: 420px) {
      .brand {
        font-size: 12px;
      }

      .brand small {
        font-size: 9px;
        letter-spacing: 1px;
      }

      main {
        padding: 28px 12px;
      }

      h1 {
        font-size: 33px;
      }

      .card {
        padding: 22px 14px;
      }

      .result {
        padding: 18px 12px;
      }

      .result h2 {
        font-size: 18px;
      }

      .account-name {
        font-size: 12px;
      }

      .account-row {
        gap: 5px;
      }

      .account-row label {
        font-size: 10px;
      }

      .account-row input {
        font-size: 12px;
      }

      .account-row button {
      min-height: 28px;
      padding: 4px 8px;
      font-size: 11px;
    }
    }
  </style>
</head>

<body>
  <header class="header">
    <div class="mark" aria-hidden="true">C</div>

    <div class="brand">
      CITY BROKERAGE LIMITED
      <small>INVESTOR SERVICES</small>
    </div>
  </header>

  <main>
    <section>
      <div class="eyebrow">Deposit account lookup</div>

      <h1>
        Find your <span>deposit account number.</span>
      </h1>

      <p class="intro">
        Enter your investor code to view the deposit bank
        account number linked to your account.
      </p>
    </section>

    <section class="card" aria-labelledby="lookup-title">
      <h2 id="lookup-title">Find your deposit account</h2>

      <p class="description">
        Use your investor code exactly as registered,
        including any leading zeros.
      </p>

      <form method="post" action="/va">
        <label for="investor-code">Investor code</label>

        <input
          id="investor-code"
          name="investorCode"
          type="text"
          value="${escapeHtml(code)}"
          placeholder=""
          maxlength="50"
          pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,49}"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          required
        >

        <button class="submit" type="submit">
          Find deposit account
        </button>

        <p class="hint">
          Enter your investor code, not your BO account number.
        </p>
      </form>

      ${
        error
          ? `
          <div class="error" role="alert">
            ${escapeHtml(error)}
          </div>
          `
          : ''
      }

      ${
        account !== null
          ? `
          <section class="result" aria-label="Your account details">
            <h2>Your Account Details</h2>

            <p class="account-name">
              <strong>Account Name:</strong> City Brokerage Limited
            </p>

            <div class="account-line">
              <div class="account-row">
                <label for="account-number">
                  Deposit Account Number:
                </label>

                <input
                  id="account-number"
                  type="text"
                  value="${escapeHtml(account)}"
                  style="width: ${Math.max(
                    8,
                    String(account).length + 1
                  )}ch"
                  readonly
                  aria-label="Virtual account number"
                >

                <button id="copy-account" type="button">
                  Copy
                </button>
              </div>
            </div>

            <p
              id="copy-status"
              class="copy-status"
              role="status"
              aria-live="polite"
            ></p>
          </section>
          `
          : ''
      }
    </section>
  </main>

  <footer>
    City Brokerage Limited &middot;
    Need help? Contact your relationship manager.
  </footer>

  <script nonce="${escapeHtml(nonce)}">
    const field = document.getElementById('account-number');
    const button = document.getElementById('copy-account');
    const status = document.getElementById('copy-status');

    if (field && button && status) {
      button.addEventListener('click', async () => {
        const accountNumber = field.value;
        let copied = false;

        button.disabled = true;

        try {
          if (window.isSecureContext && navigator.clipboard) {
            try {
              await navigator.clipboard.writeText(accountNumber);
              copied = true;
            } catch {}
          }

          if (!copied) {
            field.focus();
            field.select();
            field.setSelectionRange(0, accountNumber.length);

            try {
              copied = document.execCommand('copy');
            } catch {}
          }

          button.textContent = copied ? 'Copied' : 'Copy';

          status.textContent = copied
            ? 'Account number copied.'
            : 'Select the account number and copy it manually.';

          setTimeout(() => {
            button.textContent = 'Copy';
          }, 6000);
        } finally {
          button.disabled = false;
        }
      });
    }
  </script>
</body>
</html>`;
}

module.exports = page;
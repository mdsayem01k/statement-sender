// Renders a simple styled HTML error page.
// Used for browser-facing endpoints (like /api/pdf) where the client
// hitting a bad URL should see a readable page, not raw JSON.
function renderHtmlError(statusCode, title, message) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${statusCode} ${title}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f8f9fa;
          color: #333;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          text-align: center;
        }
        .box {
          background: #fff;
          padding: 40px 50px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        }
        h1 { color: #d32f2f; margin-bottom: 10px; font-size: 28px; }
        p { color: #555; font-size: 15px; margin: 0; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>${statusCode} ${title}</h1>
      
      </div>
    </body>
    </html>
  `;
}

function sendHtmlError(res, statusCode, title, message) {
  return res.status(statusCode).send(renderHtmlError(statusCode, title, message));
}

module.exports = { renderHtmlError, sendHtmlError };
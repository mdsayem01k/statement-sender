import { useState } from "react";
import { SAMPLE, DECLARATION } from "../services/Sampleapplication.js";
import { exportBoPdf } from "../services/Exportbopdf.js";

/*
  BO account application preview + "Export PDF".
  - Pass your real data through the `application` prop (same shape as SAMPLE below).
  - A "#" label renders a sub-heading (e.g. "Nominee 1").
  - `documents` takes image URLs / data URLs; missing ones show "Not uploaded".
  - "Download PDF" builds the file directly (jsPDF + jspdf-autotable) and
    downloads it, with no print dialog. Install: npm i jspdf jspdf-autotable
*/

const css = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
.pv{--red:#F20823;--ink:#062C33;--muted:#5B6F74;--line:#D9E0E2;--soft:#F4F6F7;
  font-family:'Poppins','Segoe UI',Arial,sans-serif;color:var(--ink);background:#E8ECED;min-height:100vh;padding:24px 16px 48px}
.pv *{box-sizing:border-box}
.pv-bar{max-width:820px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.pv-bar p{margin:0;color:var(--muted);font-size:14px}
.pv-btn{height:44px;padding:0 22px;border:0;border-radius:4px;background:var(--red);color:#fff;font:700 16px inherit;font-family:inherit;cursor:pointer}
.pv-btn:hover{background:#C4051C}
.pv-btn:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.pv-page{max-width:820px;margin:0 auto;background:#fff;padding:0 0 32px;box-shadow:0 1px 6px rgba(6,44,51,.15)}
.pv-head{background:#AA0000;color:#fff;padding:22px 32px;display:flex;align-items:center;gap:14px;border-bottom:5px solid var(--ink)}
.pv-logo{height:52px;width:auto;max-width:200px;object-fit:contain;background:#fff;padding:6px 10px;border-radius:4px;flex:none;box-sizing:border-box}
.pv-head h1{font-size:22px;margin:0;line-height:1.15}
.pv-head p{margin:2px 0 0;font-size:13px;color:#fff}
.pv-body{padding:8px 32px 0}
.pv-sec{margin-top:22px;break-inside:avoid-page}
.pv-sec h2{font-size:15px;font-weight:700;margin:0 0 8px;padding:7px 10px;background:var(--soft);border-left:4px solid var(--red)}
.pv-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:28px}
.pv-row{display:flex;gap:10px;padding:7px 2px;border-bottom:1px solid var(--line);break-inside:avoid;font-size:14px;line-height:1.35}
.pv-row.wide{grid-column:1 / -1}
.pv-l{flex:0 0 46%;color:var(--muted)}
.pv-row.wide .pv-l{flex-basis:23%}
.pv-v{flex:1;font-weight:600;overflow-wrap:anywhere}
.pv-v.empty{color:#9AA9AD;font-weight:400}
.pv-sub{grid-column:1 / -1;font-weight:700;font-size:14px;margin:10px 0 2px;color:var(--red)}
.pv-docs{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.pv-doc{break-inside:avoid;font-size:12.5px}
.pv-doc div{aspect-ratio:4/3;border:1.5px dashed var(--line);border-radius:4px;display:flex;align-items:center;justify-content:center;color:#9AA9AD;background:var(--soft);overflow:hidden;text-align:center;padding:4px}
.pv-doc img{width:100%;height:100%;object-fit:contain}
.pv-doc span{display:block;margin-top:5px;font-weight:600}
.pv-decl{font-size:13.5px;line-height:1.55;margin:0 0 20px;text-align:justify}
.pv-sign{width:260px;margin-left:auto;text-align:center;font-size:13px;font-weight:600}
.pv-sign div{height:80px;border-bottom:1.5px solid var(--ink);display:flex;align-items:flex-end;justify-content:center}
.pv-sign img{max-height:76px;max-width:100%}
.pv-sign span{display:block;margin-top:6px}
@media(max-width:640px){.pv-grid{grid-template-columns:1fr}.pv-docs{grid-template-columns:repeat(2,1fr)}.pv-head,.pv-body{padding-left:16px;padding-right:16px}.pv-row.wide .pv-l,.pv-l{flex-basis:44%}}
@page{size:A4;margin:12mm}
`;

function Row({ label, value }) {
  if (label === "#") return <div className="pv-sub">{value}</div>;
  const has = value !== "" && value != null;
  const wide = has && String(value).length > 34;
  return (
    <div className={"pv-row" + (wide ? " wide" : "")}>
      <span className="pv-l">{label}</span>
      <span className={"pv-v" + (has ? "" : " empty")}>{has ? String(value) : "—"}</span>
    </div>
  );
}

export default function BOApplicationPreview({ application = SAMPLE, onBack }) {
  const [busy, setBusy] = useState(false);
  const { sections, documents = {}, applicantSignature } = application;

  const [error, setError] = useState("");
  const exportPdf = async () => {
    setBusy(true); setError("");
    try { await exportBoPdf(application); }
    catch (e) { console.error(e); setError("Could not create the PDF. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <div className="pv">
      <style>{css}</style>

      <div className="pv-bar">
        <p role="status">{error || "Review the details below, then download a copy as PDF."}</p>
        <div style={{ display: "flex", gap: 10 }}>
          {onBack && (
            <button className="pv-btn" style={{ background: "#fff", color: "#062C33", border: "1.5px solid #062C33" }} onClick={onBack}>
              Edit details
            </button>
          )}
          <button className="pv-btn" onClick={exportPdf} disabled={busy}>
            {busy ? "Preparing PDF…" : "Download PDF"}
          </button>
        </div>
      </div>

      <article className="pv-page" aria-label="BO account application preview">
        <header className="pv-head">
          <img src="/images/city-logo.png" alt="City Brokerage" className="pv-logo" />
          <div>
            <h1>BO Account Application</h1>
          
          </div>
        </header>

        <div className="pv-body">
          {sections.map((s) => (
            <section className="pv-sec" key={s.title}>
              <h2>{s.title}</h2>
              <div className="pv-grid">
                {s.fields.map(([l, v], i) => <Row key={l + i} label={l} value={v} />)}
              </div>
            </section>
          ))}

          <section className="pv-sec">
            <h2>Applicant Documents</h2>
            <div className="pv-docs">
              {Object.entries(documents).map(([name, src]) => (
                <figure className="pv-doc" key={name} style={{ margin: 0 }}>
                  <div>{src ? <img src={src} alt={name} /> : "Not uploaded"}</div>
                  <span>{name}</span>
                </figure>
              ))}
            </div>
          </section>

          <section className="pv-sec">
            <h2>Declaration</h2>
            <p className="pv-decl">{DECLARATION}</p>
            <div className="pv-sign">
              <div>{applicantSignature && <img src={applicantSignature} alt="Applicant signature" />}</div>
              <span>Applicant's signature</span>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
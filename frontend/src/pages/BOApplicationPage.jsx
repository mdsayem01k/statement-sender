import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import BOApplicationPreview from "./Boapplicationpreview.jsx";
import { fetchBoApplication } from "../services/Boapi.js";
import { exportBoPdf } from "../services/Exportbopdf.js"; // adjust to where your PDF file lives

// Usage: /BOApplicationPage/2821   and   /BOApplicationPage/2821&download=1
// (also works with /BOApplicationPage/2821?download=1)
export default function BOApplicationPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const [id, ...flags] = (params.id || "").split("&");
  const autoDownload =
    flags.some((f) => f.toLowerCase() === "download=1") || search.get("download") === "1";

  const [application, setApplication] = useState(null);
  const [error, setError] = useState("");
  const downloaded = useRef(false);

  useEffect(() => {
    if (!/^\d+$/.test(id)) { setError("Invalid or missing id in URL"); return; }
    const ctrl = new AbortController();
    fetchBoApplication(id, { signal: ctrl.signal })
      .then(setApplication)
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    if (!autoDownload || !application || downloaded.current) return;
    downloaded.current = true;
    exportBoPdf(application);
  }, [application, autoDownload]);

  if (error) return <p role="alert" style={{ padding: 48, textAlign: "center" }}>{error}</p>;
  if (!application) return <p role="status" style={{ padding: 48, textAlign: "center" }}>Loading…</p>;
  return <BOApplicationPreview application={application} />;
}
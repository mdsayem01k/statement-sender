// Calls your Node API and returns { sections, documents, applicantSignature }.
// Change API_BASE / the path to match your server (your log shows port 4000).
const API_BASE = "http://localhost:4000";

export async function fetchBoApplication(id, { signal } = {}) {
  const res = await fetch(`${API_BASE}/api/bo-registrations/${encodeURIComponent(id)}/application`, {
    signal,
    headers: { Accept: "application/json" },
    // credentials: "include", // uncomment if your API uses cookie auth
    // headers: { Authorization: `Bearer ${token}` }, // or a token
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).message || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}
const API_BASE = import.meta.env.VITE_API_BASE;

export const buildPdfUrl = (encryptoCode) => {
  return `${API_BASE}/api/pdf?code=${encodeURIComponent(encryptoCode)}`;
};
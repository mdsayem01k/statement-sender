// "VA-3990034003128-TOWHIDUR RAHMAN (3128)" -> { account: "VA-3990034003128", name: "TOWHIDUR RAHMAN" }
function parseDescription(desc) {
  const text = String(desc || '').trim();
  const m = /^(VA-[^-]+)-(.*)$/i.exec(text);
  return {
    account: m ? m[1].trim() : '',
    name: (m ? m[2] : text).replace(/\s*\(\d+\)\s*$/, '').trim(),
  };
}

module.exports = { parseDescription };

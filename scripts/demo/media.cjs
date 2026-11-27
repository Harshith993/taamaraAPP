// Pictures the demo "takes" on camera: a lit stage for proof of work, and a photo of a paper invoice.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function makeMedia(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const w = 2400, h = 1600;
  const beams = [300, 700, 1100, 1500, 1900, 2200]
    .map((x, i) => `<polygon points="${x},${h * 0.78} ${x - 260},0 ${x + 260},0" fill="url(#beam${i % 3})" opacity=".55"/>`)
    .join("");
  const stars = Array.from({ length: 140 }, (_, i) => `<circle cx="${(i * 173) % w}" cy="${60 + ((i * 97) % 500)}" r="${3 + (i % 4)}" fill="#F3C644" opacity="${0.4 + (i % 5) * 0.12}"/>`).join("");
  const stage = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B0B2E"/><stop offset=".7" stop-color="#5B1A45"/><stop offset="1" stop-color="#E8963A"/></linearGradient>
      <linearGradient id="beam0" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#F3C644"/><stop offset="1" stop-color="#F3C644" stop-opacity="0"/></linearGradient>
      <linearGradient id="beam1" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#DD619A"/><stop offset="1" stop-color="#DD619A" stop-opacity="0"/></linearGradient>
      <linearGradient id="beam2" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#sky)"/>
    <path d="M0 ${h * 0.62} L300 ${h * 0.5} L520 ${h * 0.56} L760 ${h * 0.44} L1000 ${h * 0.52} L1300 ${h * 0.4} L1600 ${h * 0.5} L1900 ${h * 0.45} L2400 ${h * 0.58} L2400 ${h} L0 ${h}Z" fill="#2B1020"/>
    ${beams}${stars}
    <rect x="0" y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="#3A1328"/>
    ${[300, 700, 1100, 1500, 1900, 2200].map((x) => `<rect x="${x - 40}" y="${h * 0.76}" width="80" height="60" rx="10" fill="#111"/><circle cx="${x}" cy="${h * 0.76}" r="26" fill="#FFF3C4"/>`).join("")}
  </svg>`;
  const photo = path.join(dir, "IMG_2911.jpg");
  fs.writeFileSync(photo, await sharp(Buffer.from(stage)).jpeg({ quality: 88 }).toBuffer());

  const lines = [
    ["LED uplighters with operator", "12", "1,500", "18,000"],
    ["Generator, 25 kVA", "1", "6,000", "6,000"],
  ];
  const inv = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
    <rect width="1200" height="1600" fill="#E9E4DA"/>
    <rect x="80" y="70" width="1040" height="1460" fill="#FFFDF8" transform="rotate(-1.2 600 800)"/>
    <g transform="rotate(-1.2 600 800)" font-family="DejaVu Sans, sans-serif" fill="#222">
      <text x="140" y="190" font-size="58" font-weight="bold">ROSHNI LIGHTS</text>
      <text x="140" y="240" font-size="26" fill="#555">Lighting · Jaipur · GSTIN 08ABCPR1234L1Z9</text>
      <text x="140" y="340" font-size="40" font-weight="bold">TAX INVOICE  RL/1187</text>
      <text x="140" y="390" font-size="26" fill="#555">To: Taamara Taamara · Neha &amp; Vivek pre-wedding shoot</text>
      <line x1="140" y1="440" x2="1060" y2="440" stroke="#999" stroke-width="2"/>
      ${lines.map((l, i) => `<text x="140" y="${510 + i * 60}" font-size="28">${l[0]}</text><text x="700" y="${510 + i * 60}" font-size="28">${l[1]} × ${l[2]}</text><text x="1060" y="${510 + i * 60}" font-size="28" text-anchor="end">${l[3]}</text>`).join("")}
      <line x1="140" y1="660" x2="1060" y2="660" stroke="#999" stroke-width="2"/>
      <text x="1060" y="720" font-size="28" text-anchor="end">Taxable 24,000 · GST 18% 4,320</text>
      <text x="1060" y="790" font-size="40" font-weight="bold" text-anchor="end">Total ₹28,320</text>
      <text x="140" y="1400" font-size="26" fill="#555">For Roshni Lights — M. Saini</text>
    </g>
  </svg>`;
  const invoice = path.join(dir, "invoice-RL-1187.jpg");
  fs.writeFileSync(invoice, await sharp(Buffer.from(inv)).jpeg({ quality: 85 }).toBuffer());
  return { photo, invoice };
}

module.exports = { makeMedia };

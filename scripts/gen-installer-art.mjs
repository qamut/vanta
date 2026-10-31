// Gera as imagens BMP do instalador NSIS (cabeçalho 150x57 e lateral 164x314)
// desenhando a cápsula do VANTA proceduralmente, sem dependências.
import { writeFileSync, mkdirSync } from "node:fs";

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG0 = hex("#050509"), BG1 = hex("#140C26"), VIOLET = hex("#8B5CF6"), LIGHT = hex("#C4B5FD");

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(w, h, capsule) {
  const px = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (x - capsule.cx) / (w * 0.9), gy = (y - capsule.cy) / (h * 0.6);
    const glow = Math.max(0, 1 - Math.hypot(gx, gy));
    let c = mix(BG0, BG1, Math.min(1, glow * 1.2));
    c = mix(c, VIOLET, glow * glow * 0.35);
    const d = sdRoundRect(x + 0.5, y + 0.5, capsule.cx, capsule.cy, capsule.hw, capsule.hh, capsule.hh);
    if (d < 0) c = mix([3, 3, 6], c, Math.max(0, 1 + d));
    const rim = Math.abs(d + capsule.stroke / 2) - capsule.stroke / 2;
    if (rim < 1) c = mix(mix(LIGHT, VIOLET, x / w), c, Math.max(0, Math.min(1, rim)));
    for (const ex of [capsule.cx - capsule.eye * 1.6, capsule.cx + capsule.eye * 1.6]) {
      const de = sdRoundRect(x + 0.5, y + 0.5, ex, capsule.cy, capsule.eye / 2, capsule.eye * 1.25, capsule.eye / 2);
      if (de < 1) c = mix(mix([255, 255, 255], LIGHT, (y - capsule.cy + capsule.eye) / (capsule.eye * 3)), c, Math.max(0, Math.min(1, de)));
    }
    px[y * w + x] = c.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  }
  return px;
}

function bmp(w, h, px) {
  const row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size);
  b.write("BM", 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, bl] = px[(h - 1 - y) * w + x], o = 54 + y * row + x * 3;
    b[o] = bl; b[o + 1] = g; b[o + 2] = r;
  }
  return b;
}

mkdirSync("src-tauri/installer", { recursive: true });
writeFileSync("src-tauri/installer/header.bmp", bmp(150, 57, render(150, 57, { cx: 118, cy: 28, hw: 24, hh: 11, stroke: 2, eye: 3 })));
writeFileSync("src-tauri/installer/sidebar.bmp", bmp(164, 314, render(164, 314, { cx: 82, cy: 140, hw: 58, hh: 22, stroke: 3, eye: 6 })));
console.log("arte do instalador gerada");

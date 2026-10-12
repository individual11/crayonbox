/**
 * Cuts a rendered guide into PNG slices for review: `npm run slices -- guide.svg /tmp/slice 1100`.
 * Renders the whole SVG once and cuts the pixels, because resvg panics on SVGs cropped by viewBox.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
const [file, outPrefix = "slice", sliceH = "1100"] = process.argv.slice(2);
const img = new Resvg(readFileSync(file, "utf8"), { background: "#fff", fitTo: { mode: "zoom", value: 1 } }).render();
const { width: W, height: H } = img;
const px = img.pixels;
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const h = +sliceH;
const n = Math.ceil(H / h);
for (let i = 0; i < n; i++) {
  const y0 = i * h, rows = Math.min(h, H - y0);
  const raw = Buffer.alloc(rows * (W * 4 + 1));
  for (let y = 0; y < rows; y++) px.copy(raw, y * (W * 4 + 1) + 1, (y0 + y) * W * 4, (y0 + y + 1) * W * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(rows, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(`${outPrefix}${i}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
console.log(`${W}x${H} → ${n} slices`);

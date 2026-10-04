// Installs the Godot export templates a Windows build needs — only those three files,
// pulled out of the official 1.2 GB archive with HTTP range requests, so nothing else is
// downloaded. Run once per Godot version, then export (docs/ai/godot-port.md):
//
//   node godot/tools/fetch-export-templates.mjs
//
// They land where the editor looks for them: %APPDATA%/Godot/export_templates/<version>.stable.mono.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const VERSION = '4.7.2';
const URL = `https://github.com/godotengine/godot-builds/releases/download/${VERSION}-stable/Godot_v${VERSION}-stable_mono_export_templates.tpz`;
const OUT = join(process.env.APPDATA ?? '.', 'Godot', 'export_templates', `${VERSION}.stable.mono`);
const WANTED = ['version.txt', 'windows_release_x86_64.exe', 'windows_release_x86_64_console.exe'];
const PIECE = 4 << 20;

/** Bytes start..end of the archive, in pieces, each retried: a long ranged download can be cut off. */
async function range(start, end) {
  const parts = [];
  for (let at = start; at <= end; at += PIECE) {
    const last = Math.min(end, at + PIECE - 1);
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(URL, { headers: { Range: `bytes=${at}-${last}` }, redirect: 'follow' });
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== last - at + 1) throw new Error(`short read: ${buf.length}`);
        parts.push(buf);
        break;
      } catch (error) {
        if (attempt >= 6) throw error;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  return Buffer.concat(parts);
}

/** The archive's table of contents, from its central directory at the end (zip64 aware). */
async function entries() {
  const head = await fetch(URL, { method: 'HEAD', redirect: 'follow' });
  const size = Number(head.headers.get('content-length'));
  const tail = await range(size - 65557, size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  const z64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  if (cdOffset === 0xffffffff && z64 >= 0) {
    cdSize = Number(tail.readBigUInt64LE(z64 + 40));
    cdOffset = Number(tail.readBigUInt64LE(z64 + 48));
  }
  const cd = await range(cdOffset, cdOffset + cdSize - 1);
  const out = [];
  for (let p = 0; p < cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    let comp = cd.readUInt32LE(p + 20);
    let uncomp = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    let local = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString();
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    for (let q = 0; q < extra.length; ) {
      const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2);
      if (id === 1) {
        let r = q + 4;
        if (uncomp === 0xffffffff) { uncomp = Number(extra.readBigUInt64LE(r)); r += 8; }
        if (comp === 0xffffffff) { comp = Number(extra.readBigUInt64LE(r)); r += 8; }
        if (local === 0xffffffff) { local = Number(extra.readBigUInt64LE(r)); r += 8; }
      }
      q += 4 + len;
    }
    out.push({ name, method, comp, uncomp, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const listing = await entries();
mkdirSync(OUT, { recursive: true });
for (const name of WANTED) {
  const entry = listing.find((e) => e.name === `templates/${name}`);
  if (entry === undefined) throw new Error(`not in the archive: ${name}`);
  const header = await range(entry.local, entry.local + 29);
  const dataStart = entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const packed = await range(dataStart, dataStart + entry.comp - 1);
  const data = entry.method === 8 ? inflateRawSync(packed) : packed;
  if (data.length !== entry.uncomp) throw new Error(`${name}: ${data.length} bytes, expected ${entry.uncomp}`);
  writeFileSync(join(OUT, name), data);
  console.log(`${name}: ${(data.length / 1e6).toFixed(1)} MB`);
}
console.log(`installed in ${OUT}`);

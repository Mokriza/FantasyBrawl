// Keeps in each character model only the animations the 3D board plays, and drops the
// data of the rest from the file: a KayKit character carries 76 to 95 animations, the
// board uses a handful. Which ones are kept is read from godot/Game/assets/board3d.json
// (each class's idle, attack and cast, plus the shared moves and "Idle" as a fallback).
//
//   node godot/tools/trim-animations.mjs            trims the models in place
//   node godot/tools/trim-animations.mjs --dry      only says what it would keep
//
// Run it again after adding an animation to board3d.json — but from the original
// downloads: an animation dropped once is gone from the trimmed file.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = 'godot/Game/assets';
const manifest = JSON.parse(readFileSync(join(ASSETS, 'board3d.json'), 'utf8'));
const dry = process.argv.includes('--dry');

// Which animations each model file needs.
const keep = new Map();
for (const [classId, art] of Object.entries(manifest.heroes)) {
  if (classId.startsWith('_')) continue;
  const names = keep.get(art.model) ?? new Set(['Idle', ...Object.values(manifest.moves)]);
  for (const n of [art.idle, art.attack, art.cast]) names.add(n);
  keep.set(art.model, names);
}

function readGlb(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binStart);
  return { json, bin: buffer.subarray(binStart + 8, binStart + 8 + binLength) };
}

function writeGlb(json, bin) {
  const pad = (b, fill) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]));
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunkHeader = (length, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]);
}

/** Drops unlisted animations, then every accessor, buffer view and byte no longer referenced. */
function trim(json, bin, wanted) {
  const before = json.animations?.length ?? 0;
  json.animations = (json.animations ?? []).filter((a) => wanted.has(a.name));

  // Accessors still in use: meshes, skins, the kept animations.
  const usedAccessors = new Set();
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives) {
      for (const a of Object.values(p.attributes)) usedAccessors.add(a);
      if (p.indices !== undefined) usedAccessors.add(p.indices);
      for (const target of p.targets ?? []) for (const a of Object.values(target)) usedAccessors.add(a);
    }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const anim of json.animations) for (const s of anim.samplers) usedAccessors.add(s.input).add(s.output);

  const accessorMap = new Map();
  const accessors = [];
  json.accessors.forEach((a, i) => {
    if (!usedAccessors.has(i)) return;
    accessorMap.set(i, accessors.length);
    accessors.push(a);
  });
  const reAccessor = (i) => accessorMap.get(i);
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = reAccessor(p.attributes[k]);
      if (p.indices !== undefined) p.indices = reAccessor(p.indices);
      for (const target of p.targets ?? []) for (const k of Object.keys(target)) target[k] = reAccessor(target[k]);
    }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = reAccessor(skin.inverseBindMatrices);
  for (const anim of json.animations) for (const s of anim.samplers) {
    s.input = reAccessor(s.input);
    s.output = reAccessor(s.output);
  }
  json.accessors = accessors;

  // Buffer views still in use: the kept accessors and the images.
  const usedViews = new Set();
  for (const a of accessors) if (a.bufferView !== undefined) usedViews.add(a.bufferView);
  for (const img of json.images ?? []) if (img.bufferView !== undefined) usedViews.add(img.bufferView);

  const viewMap = new Map();
  const views = [];
  const parts = [];
  let offset = 0;
  json.bufferViews.forEach((v, i) => {
    if (!usedViews.has(i)) return;
    const bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    viewMap.set(i, views.length);
    views.push({ ...v, byteOffset: offset });
    parts.push(bytes);
    offset += bytes.length;
  });
  for (const a of accessors) if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
  for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);
  json.bufferViews = views;
  const out = Buffer.concat(parts);
  json.buffers = [{ byteLength: out.length }];
  return { bin: out, before, after: json.animations.length };
}

let saved = 0;
for (const [model, names] of keep) {
  const path = join(ASSETS, 'kaykit', model);
  const file = readFileSync(path);
  const { json, bin } = readGlb(file);
  const missing = [...names].filter((n) => !json.animations?.some((a) => a.name === n));
  const result = trim(json, bin, names);
  const out = writeGlb(json, result.bin);
  saved += file.length - out.length;
  console.log(`${model}: ${result.before} -> ${result.after} animations, ${(file.length / 1e6).toFixed(1)} -> ${(out.length / 1e6).toFixed(1)} MB` +
    (missing.length > 0 ? `; not in the model (falls back to Idle): ${missing.join(', ')}` : ''));
  if (!dry) writeFileSync(path, out);
}
console.log(`${dry ? 'would save' : 'saved'} ${(saved / 1e6).toFixed(1)} MB`);

// Read only: inspect Windows/Crashpad minidump metadata without uploading memory.
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node inspect-minidump.mjs <absolute .dmp path>');
  process.exit(2);
}
const data = fs.readFileSync(file);
const safe = (position, length) => position >= 0 && length >= 0 && position + length <= data.length;
if (!safe(0, 32) || data.toString('ascii', 0, 4) !== 'MDMP') throw new Error('Invalid minidump signature/header');
const count = data.readUInt32LE(8);
const directoryOffset = data.readUInt32LE(12);
if (count > 1000 || !safe(directoryOffset, count * 12)) throw new Error('Invalid stream directory');
const streams = [];
for (let i = 0; i < count; i++) {
  const offset = directoryOffset + i * 12;
  const type = data.readUInt32LE(offset);
  const size = data.readUInt32LE(offset + 4);
  const rva = data.readUInt32LE(offset + 8);
  if (!safe(rva, size)) throw new Error('Out-of-bounds stream ' + type);
  streams.push({ type, size, rva });
}
const findStream = (type) => streams.find(x => x.type === type);
const hex = (value) => '0x' + value.toString(16).toUpperCase();
const report = {
  file: path.basename(file), bytes: data.length,
  modified_utc: fs.statSync(file).mtime.toISOString(),
  streams: streams.map(s => ({ type: s.type, bytes: s.size })),
};
const misc = findStream(15);
if (misc && misc.size >= 24) {
  const o = misc.rva;
  const flags = data.readUInt32LE(o + 4);
  report.process = {
    pid: (flags & 1) ? data.readUInt32LE(o + 8) : null,
    created_utc: (flags & 2) ? new Date(data.readUInt32LE(o + 12) * 1000).toISOString() : null,
  };
}
const exception = findStream(6);
if (exception && exception.size >= 40) {
  const o = exception.rva;
  report.exception = {
    thread_id: data.readUInt32LE(o),
    code: hex(data.readUInt32LE(o + 8)),
    flags: hex(data.readUInt32LE(o + 12)),
    address: hex(data.readBigUInt64LE(o + 24)),
    parameter_count: data.readUInt32LE(o + 32),
  };
}
const modules = findStream(4);
if (modules && modules.size >= 4) {
  const n = data.readUInt32LE(modules.rva);
  const output = [];
  if (n < 4000 && safe(modules.rva + 4, n * 108)) {
    for (let i = 0; i < n; i++) {
      const m = modules.rva + 4 + i * 108;
      const base = data.readBigUInt64LE(m);
      const size = data.readUInt32LE(m + 8);
      const nameRva = data.readUInt32LE(m + 20);
      let name = '<unavailable>';
      if (safe(nameRva, 4)) {
        const bytes = data.readUInt32LE(nameRva);
        if (bytes < 4096 && safe(nameRva + 4, bytes)) {
          name = path.win32.basename(data.toString('utf16le', nameRva + 4, nameRva + 4 + bytes));
        }
      }
      const match = report.exception &&
        BigInt(report.exception.address) >= base &&
        BigInt(report.exception.address) < base + BigInt(size);
      if (match) report.exception.module = name;
      output.push({ name, base: hex(base), size_bytes: size });
    }
  }
  report.module_count = output.length;
  report.modules = output.map(m => m.name).slice(0, 30);
}
console.log(JSON.stringify(report, null, 2));

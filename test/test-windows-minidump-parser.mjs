import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-minidump-fixture-'));
const filename = path.join(tmp, 'synthetic.dmp');
const b = Buffer.alloc(1024);
b.write('MDMP', 0, 'ascii');
b.writeUInt32LE(3, 8); // three streams
b.writeUInt32LE(32, 12); // stream directory
function stream(index, type, size, rva) {
  const o = 32 + index * 12;
  b.writeUInt32LE(type, o);
  b.writeUInt32LE(size, o + 4);
  b.writeUInt32LE(rva, o + 8);
}
stream(0, 6, 168, 128); // ExceptionStream
stream(1, 15, 24, 320); // MiscInfoStream
stream(2, 4, 112, 512); // ModuleListStream
b.writeUInt32LE(777, 128);
b.writeUInt32LE(0x80000003, 136);
b.writeBigUInt64LE(0x100100n, 152);
b.writeUInt32LE(24, 320);
b.writeUInt32LE(3, 324);
b.writeUInt32LE(54321, 328);
b.writeUInt32LE(1791521000, 332);
b.writeUInt32LE(1, 512);
b.writeBigUInt64LE(0x100000n, 516);
b.writeUInt32LE(0x2000, 524);
b.writeUInt32LE(800, 536);
const name = Buffer.from('example.dll', 'utf16le');
b.writeUInt32LE(name.length, 800);
name.copy(b, 804);
try {
  fs.writeFileSync(filename, b);
  const script = new URL('../scripts/windows/inspect-minidump.mjs', import.meta.url);
  const test = spawnSync(process.execPath, [script.pathname.replace(/^\/(?=[A-Z]:)/, ''), filename], { encoding: 'utf8' });
  assert.equal(test.status, 0, test.stderr);
  const report = JSON.parse(test.stdout);
  assert.equal(report.process.pid, 54321);
  assert.equal(report.exception.code, '0x80000003');
  assert.equal(report.exception.module, 'example.dll');
  assert.equal(report.module_count, 1);
  console.log('PASS: synthetic minidump exception, PID and module resolution');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

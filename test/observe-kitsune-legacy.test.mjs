import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConnection, makeObservation } from '../scripts/observe-kitsune-legacy.mjs';

const status = `KITSUNE MCP v0.22.5
PERSISTENT CONNECTIONS (2)
  dc-i9es-opaque-publisher | PID 1822422 | alive+responsive | uptime: 7320s | calls: 160 | mem: 70MB
  dc-i9es-stdio-opaque | PID 2398586 | alive+responsive | uptime: 1830s | calls: 42 | mem: 109MB
ACTIVE NODES
  dc-i9es-opaque-publisher | 211 calls | last: start_process
`;

test('extracts live PID and current connection call count, not historical node totals', () => {
  assert.deepEqual(parseConnection(status, 'dc-i9es-opaque-publisher'), {pid:1822422,calls:160});
  assert.deepEqual(parseConnection(status, 'dc-i9es-stdio-opaque'), {pid:2398586,calls:42});
  assert.equal(parseConnection(status,'absent'),null);
});

test('records only process counts and file metadata, never raw tool content', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kitsune-alias-observe-'));
  try {
    const file=path.join(dir,'history.jsonl');
    fs.writeFileSync(file,'{"command":"private secret"}\n',{mode:0o600});
    const sample=makeObservation(status,file,'2026-11-18T16:20:00Z');
    assert.equal(sample.legacyAlias.calls,160);
    assert.ok(sample.legacyHistory.bytes>0);
    assert.equal(sample.retirementAuthorized,false);
    assert.equal(JSON.stringify(sample).includes('private secret'),false);
    assert.equal(makeObservation(status,path.join(dir,'missing')).legacyHistory,null);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConnection, makeObservation, compareActivity, readLastObservation } from '../scripts/observe-kitsune-legacy.mjs';

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

test('detects new legacy calls and history growth without authorizing retirement', () => {
  const previous = {
    at:'2026-11-18T16:30:00Z',
    legacyAlias:{pid:1822422,calls:160},
    upgradedAlias:{pid:2398586,calls:42},
    legacyHistory:{inode:'123',bytes:200,mtimeNs:'1'},
    lastObservedLegacyActivityAt:null,
  };
  const now = {...previous,at:'2026-11-18T16:45:00Z'};
  const stable=compareActivity(now,previous);
  assert.equal(stable.legacyActivityDetected,false);
  assert.equal(stable.legacyCallsDelta,0);
  assert.equal(stable.legacyHistoryBytesDelta,0);
  assert.equal(stable.retirementAuthorized,false);
  const growing=compareActivity({
    ...now,legacyAlias:{pid:1822422,calls:162},
    legacyHistory:{inode:'123',bytes:245,mtimeNs:'2'},
  },previous);
  assert.equal(growing.legacyActivityDetected,true);
  assert.equal(growing.legacyCallsDelta,2);
  assert.equal(growing.legacyHistoryBytesDelta,45);
  assert.equal(growing.lastObservedLegacyActivityAt,now.at);
  const reset=compareActivity({
    ...now,legacyAlias:{pid:1999999,calls:0},
  },previous);
  assert.equal(reset.baselineChanged,true);
  assert.equal(reset.legacyActivityDetected,null);
  assert.equal(reset.retirementAuthorized,false);
});

test('latest observation reads a bounded tail and rejects malformed trailing data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kitsune-observe-tail-'));
  try {
    const filename=path.join(dir,'observer.jsonl');
    assert.equal(readLastObservation(filename),null);
    const first={at:'2026-11-18T16:20:00Z',legacyAlias:{pid:1,calls:4}};
    const last={at:'2026-11-18T16:45:00Z',legacyAlias:{pid:1,calls:5}};
    fs.writeFileSync(filename,(JSON.stringify(first)+'\n').repeat(100)+JSON.stringify(last)+'\n');
    assert.deepEqual(readLastObservation(filename),last);
    fs.appendFileSync(filename,'not-json\n');
    assert.throws(()=>readLastObservation(filename),SyntaxError);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

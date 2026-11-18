const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {capture}=require('../scripts/catchup-legacy-history.cjs');
const {decode}=require('../scripts/migrate-tool-history.cjs');
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const makeRecord=(i)=>({
  timestamp:'t'+i,
  toolName:'start_process',
  arguments:{command:'echo '+i},
  output:{content:[{type:'text',text:'returned '+i}]},
});
const line=record=>JSON.stringify(record)+'\n';

test('incremental catch-up is contiguous, idempotent and lossless across append and partial records',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dc-delta-test-'));
  try {
    const source=path.join(root,'legacy.jsonl');
    const directory=path.join(root,'delta');
    const baseline=line(makeRecord(0))+line(makeRecord(1));
    fs.writeFileSync(source,baseline);
    const anchorBytes=Buffer.byteLength(baseline),anchorSha256=sha256(baseline);
    let rec=capture({source,directory,anchorBytes,anchorSha256});
    assert.equal(rec.status,'up-to-date');
    assert.equal(rec.cursor,anchorBytes);
    const batch1=line(makeRecord(2))+line(makeRecord(3));
    fs.appendFileSync(source,batch1);
    rec=capture({source,directory,anchorBytes,anchorSha256});
    assert.equal(rec.status,'captured');
    assert.equal(rec.entries,2);
    assert.equal(rec.startByte,anchorBytes);
    assert.equal(rec.endByte,anchorBytes+Buffer.byteLength(batch1));
    assert.equal(fs.statSync(rec.destination).mode & 0o777,0o600);
    const firstDest=rec.destination;
    const recovered=fs.readFileSync(firstDest,'utf8').trimEnd().split('\n').map(JSON.parse);
    assert.equal(recovered.length,2);
    assert.equal(decode(recovered[0].arguments.payload_b64).command,'echo 2');
    assert.equal(decode(recovered[1].output.content[0].text.split('] ')[1]).content[0].text,'returned 3');
    const repeat=capture({source,directory,anchorBytes,anchorSha256});
    assert.equal(repeat.status,'up-to-date');
    assert.equal(repeat.existingChunks,1);
    assert.equal(repeat.alreadyImported,2);
    const partial=JSON.stringify(makeRecord(4));
    fs.appendFileSync(source,partial);
    rec=capture({source,directory,anchorBytes,anchorSha256});
    assert.equal(rec.status,'up-to-date');
    assert.equal(rec.pendingPartialBytes,Buffer.byteLength(partial));
    fs.appendFileSync(source,'\n');
    rec=capture({source,directory,anchorBytes,anchorSha256});
    assert.equal(rec.status,'captured');
    assert.equal(rec.entries,1);
    assert.equal(rec.existingChunks,1);
    assert.equal(fs.readdirSync(directory).filter(n=>n.endsWith('.jsonl')).length,2);
    assert.equal(fs.readFileSync(source,'utf8'),baseline+batch1+partial+'\n');
    fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('echo 0','echo X'));
    assert.throws(()=>capture({source,directory,anchorBytes,anchorSha256}),/Source prefix/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('invalid newly appended JSON never creates a delta',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dc-delta-invalid-'));
  try {
    const source=path.join(root,'legacy.jsonl'),directory=path.join(root,'delta');
    const baseline=line(makeRecord(0));
    fs.writeFileSync(source,baseline+'not-json\n');
    assert.throws(()=>capture({
      source,directory,anchorBytes:Buffer.byteLength(baseline),anchorSha256:sha256(baseline)
    }),/Record 0/);
    assert.equal(fs.readdirSync(directory).filter(n=>n.endsWith('.jsonl')).length,0);
  }finally {fs.rmSync(root,{recursive:true,force:true});}
});

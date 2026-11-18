#!/usr/bin/env node
'use strict';
// Read-only source migration: builds a verified opaque snapshot without
// modifying the live JSONL used by independent, noncooperating MCP writers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function encode(value) {
  return Buffer.from(JSON.stringify(value) ?? 'null', 'utf8').toString('base64');
}
function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}
function isEncodedArguments(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 1 && typeof value.payload_b64 === 'string';
}
function isEncodedOutput(value) {
  return value?.content?.[0]?.type === 'text' &&
    typeof value.content[0].text === 'string' &&
    value.content[0].text.startsWith('[opaque-history;json-base64] ');
}
function migrateRecord(record, counts) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Malformed JSONL record');
  }
  const originalArgs = record.arguments;
  const originalOutput = record.output;
  const args = isEncodedArguments(originalArgs)
    ? originalArgs : { payload_b64: encode(originalArgs) };
  const output = isEncodedOutput(originalOutput)
    ? originalOutput : {
      content: [{ type: 'text', text: '[opaque-history;json-base64] ' + encode(originalOutput) }],
      ...(originalOutput?.isError ? { isError: true } : {}),
    };
  if (!isEncodedArguments(originalArgs)) counts.convertedArguments++;
  if (!isEncodedOutput(originalOutput)) counts.convertedOutputs++;
  const reconstructedArgs = decode(args.payload_b64);
  const prefix = '[opaque-history;json-base64] ';
  const reconstructedOutput = decode(output.content[0].text.slice(prefix.length));
  const expectedArgs = isEncodedArguments(originalArgs) ? decode(originalArgs.payload_b64) : originalArgs;
  const expectedOutput = isEncodedOutput(originalOutput)
    ? decode(originalOutput.content[0].text.slice(prefix.length)) : originalOutput;
  const equivalent = (a,b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!equivalent(reconstructedArgs, expectedArgs) || !equivalent(reconstructedOutput, expectedOutput)) {
    throw new Error('Round-trip mismatch');
  }
  return { ...record, arguments: args, output };
}
function statKey(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function readStable(source) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const fd = fs.openSync(source, 'r');
    try {
      const a = fs.fstatSync(fd, {bigint: true});
      const bytes = fs.readFileSync(fd);
      const b = fs.fstatSync(fd, {bigint: true});
      const c = fs.statSync(source, {bigint: true});
      if (statKey(a) === statKey(b) && statKey(b) === statKey(c)) {
        return {bytes, stat:b, attempt};
      }
    } finally { fs.closeSync(fd); }
  }
  throw new Error('Source changed during ten snapshot attempts; no files written');
}
function migrate(source,destination) {
  const src=path.resolve(source),dst=path.resolve(destination);
  if (src === dst) throw new Error('Destination must be different from source');
  if (fs.existsSync(dst)) throw new Error('Destination already exists: refusing overwrite');
  const {bytes,stat,attempt}=readStable(src);
  const lines=bytes.toString('utf8').split('\n').filter(x=>x.length);
  const counts={convertedArguments:0,convertedOutputs:0};
  const records=lines.map((line,index)=>{
    try {return migrateRecord(JSON.parse(line),counts);}
    catch(e){throw new Error('Record '+(index+1)+': '+e.message);}
  });
  const output=Buffer.from(records.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8');
  // Verify by decoding every record from the generated snapshot in memory.
  const migratedLines=output.toString('utf8').trimEnd().split('\n');
  if(migratedLines.length!==lines.length)throw new Error('Entry-count mismatch');
  for(let i=0;i<lines.length;i++){
    const old=JSON.parse(lines[i]),now=JSON.parse(migratedLines[i]);
    const expectedArgs=isEncodedArguments(old.arguments)?decode(old.arguments.payload_b64):old.arguments;
    const expectedOutput=isEncodedOutput(old.output)
      ?decode(old.output.content[0].text.slice('[opaque-history;json-base64] '.length)):old.output;
    if(JSON.stringify(decode(now.arguments.payload_b64))!==JSON.stringify(expectedArgs) ||
      JSON.stringify(decode(now.output.content[0].text.slice('[opaque-history;json-base64] '.length)))!==JSON.stringify(expectedOutput)){
      throw new Error('Verification failed for record '+(i+1));
    }
  }
  const tmp=dst+'.partial-'+process.pid;
  const fd=fs.openSync(tmp,'wx',0o600);
  try {
    fs.writeFileSync(fd,output);
    fs.fsyncSync(fd);
  } finally {fs.closeSync(fd);}
  try {fs.linkSync(tmp,dst);} finally {fs.unlinkSync(tmp);}
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const receipt={
    source:src,destination:dst,sourceInode:stat.ino.toString(),
    snapshotBytes:bytes.length,snapshotSha256:hash(bytes),
    destinationBytes:output.length,destinationSha256:hash(output),
    recordCount:records.length,...counts,attempts:attempt,
    sourceModifiedAfterSnapshot:statKey(fs.statSync(src,{bigint:true}))!==statKey(stat),
    originalUnmodified:true
  };
  return receipt;
}
if (require.main===module){
  if(process.argv.length!==4){console.error('Usage: node migrate-tool-history.cjs SOURCE_JSONL DEST_JSONL');process.exitCode=2;}
  else{try{console.log(JSON.stringify(migrate(process.argv[2],process.argv[3]),null,2));}
    catch(e){console.error('Migration blocked:',e.message);process.exitCode=1;}}
}
module.exports={migrate,migrateRecord,encode,decode};

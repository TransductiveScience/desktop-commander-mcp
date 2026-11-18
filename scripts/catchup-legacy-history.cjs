#!/usr/bin/env node
'use strict';

/**
 * Incremental, source-preserving migration of an append-only legacy tool history.
 *
 * Invariants:
 * - The anchor prefix belongs to an independently verified earlier snapshot.
 * - Each immutable delta covers a contiguous byte interval in that source.
 * - Repeated calls neither duplicate nor overwrite converted records.
 * - Complete newline-terminated JSONL records only; partial tails stay pending.
 * - Source rewrites, trimming, corruption or unexpected rotation abort the run.
 * - No legacy writer is stopped, patched or redirected.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { migrateRecord, decode } = require('./migrate-tool-history.cjs');

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const PREFIX = '[opaque-history;json-base64] ';

function countAndVerifyConverted(sourceLines, encodedLines) {
  if (sourceLines.length !== encodedLines.length) throw new Error('Record count mismatch');
  for (let i = 0; i < sourceLines.length; i++) {
    const original = JSON.parse(sourceLines[i]);
    const converted = JSON.parse(encodedLines[i]);
    if (Object.keys(converted.arguments || {}).join(',') !== 'payload_b64') {
      throw new Error('Missing opaque argument envelope at record ' + i);
    }
    const output = converted.output?.content?.[0]?.text;
    if (typeof output !== 'string' || !output.startsWith(PREFIX)) {
      throw new Error('Missing opaque output envelope at record ' + i);
    }
    const expectedArgs = original.arguments?.payload_b64
      ? decode(original.arguments.payload_b64) : original.arguments;
    const oldOutputText = original.output?.content?.[0]?.text;
    const expectedOutput = typeof oldOutputText === 'string' && oldOutputText.startsWith(PREFIX)
      ? decode(oldOutputText.slice(PREFIX.length)) : original.output;
    if (JSON.stringify(decode(converted.arguments.payload_b64)) !== JSON.stringify(expectedArgs) ||
        JSON.stringify(decode(output.slice(PREFIX.length))) !== JSON.stringify(expectedOutput)) {
      throw new Error('Reconstruction failed at record ' + i);
    }
  }
}

function capture({ source, directory, anchorBytes, anchorSha256 }) {
  const sourcePath = path.resolve(source);
  const archiveDir = path.resolve(directory);
  const anchor = Number(anchorBytes);
  if (!Number.isSafeInteger(anchor) || anchor < 1 || !/^[a-f0-9]{64}$/.test(anchorSha256)) {
    throw new Error('Invalid verified snapshot anchor');
  }
  if (!fs.existsSync(sourcePath)) throw new Error('Legacy source missing');
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(archiveDir, 0o700);
  const lock = path.join(archiveDir, '.capture.lock');
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const fd = fs.openSync(sourcePath, 'r');
    let bytes, before;
    try {
      before = fs.fstatSync(fd);
      bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd);
      const current = fs.statSync(sourcePath);
      if (before.ino !== after.ino || after.ino !== current.ino ||
          before.dev !== current.dev || bytes.length < anchor) {
        throw new Error('Source rotated, truncated, or replaced while reading');
      }
    } finally { fs.closeSync(fd); }

    if (sha256(bytes.subarray(0,anchor)) !== anchorSha256 ||
        bytes[anchor - 1] !== 10) {
      throw new Error('Source prefix no longer matches verified original snapshot');
    }

    const rex = /^delta-(\d+)-(\d+)-([a-f0-9]{16})\.jsonl$/;
    const files = fs.readdirSync(archiveDir).map(name => {
      const match = rex.exec(name);
      if (!match) return null;
      return { name, start: Number(match[1]), end: Number(match[2]), digest: match[3] };
    }).filter(Boolean).sort((a,b)=>a.start-b.start);

    let cursor = anchor, alreadyImported = 0, existingChunks = 0;
    for (const item of files) {
      if (!Number.isSafeInteger(item.end) || item.start !== cursor || item.end > bytes.length) {
        throw new Error('Gap/overlap or truncated source at ' + item.name);
      }
      const raw = bytes.subarray(item.start,item.end);
      if (sha256(raw).slice(0,16) !== item.digest || raw.at(-1) !== 10) {
        throw new Error('Source changed for prior immutable delta ' + item.name);
      }
      const sourceLines = raw.toString('utf8').split('\n').slice(0,-1);
      const encoded = fs.readFileSync(path.join(archiveDir,item.name),'utf8');
      if (!encoded.endsWith('\n')) throw new Error('Truncated archive delta ' + item.name);
      const encodedLines = encoded.split('\n').slice(0,-1);
      countAndVerifyConverted(sourceLines,encodedLines);
      alreadyImported += encodedLines.length;
      existingChunks++;
      cursor = item.end;
    }

    let end = bytes.lastIndexOf(10) + 1;
    if (end < cursor) end = cursor;
    if (end === cursor) {
      return {status:'up-to-date',legacySource:sourcePath,archiveDir,
        anchorBytes:anchor,cursor,existingChunks,alreadyImported,
        pendingPartialBytes:bytes.length-cursor};
    }
    const raw = bytes.subarray(cursor,end);
    if (raw.at(-1) !== 10 || (cursor && bytes[cursor-1] !== 10)) {
      throw new Error('New records do not start/end on JSONL boundaries');
    }
    const inputLines = raw.toString('utf8').split('\n').slice(0,-1);
    const counts = { convertedArguments:0, convertedOutputs:0 };
    const outputLines = inputLines.map((line,index)=>{
      try{return JSON.stringify(migrateRecord(JSON.parse(line),counts));}
      catch(err){throw new Error('Record '+index+': '+err.message);}
    });
    countAndVerifyConverted(inputLines,outputLines);
    const output = Buffer.from(outputLines.join('\n')+'\n','utf8');
    const digest = sha256(raw);
    const name = 'delta-'+cursor+'-'+end+'-'+digest.slice(0,16)+'.jsonl';
    const target = path.join(archiveDir,name);
    if (fs.existsSync(target)) throw new Error('Unexpected existing archive chunk');
    const temp = path.join(archiveDir,name+'.partial-'+process.pid);
    const outfd = fs.openSync(temp,'wx',0o600);
    try {
      fs.writeFileSync(outfd,output);
      fs.fsyncSync(outfd);
    } finally { fs.closeSync(outfd); }
    try {fs.renameSync(temp,target);} finally {
      if(fs.existsSync(temp))fs.unlinkSync(temp);
    }
    const receipt = {
      source:sourcePath,
      destination:target,
      sourceInode:before.ino,
      startByte:cursor,
      endByte:end,
      sourceSegmentSha256:digest,
      encodedSha256:sha256(output),
      entries:outputLines.length,
      ...counts,
      pendingPartialBytes:bytes.length-end,
      sourceUnmodified:true,
    };
    const receiptPath=target+'.receipt.json';
    fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    return {status:'captured',...receipt,existingChunks,alreadyImported};
  } finally {
    fs.rmdirSync(lock);
  }
}

if (require.main === module) {
  if (process.argv.length !== 6) {
    console.error('Usage: node catchup-legacy-history.cjs SOURCE_JSONL DELTA_DIRECTORY VERIFIED_ANCHOR_BYTES VERIFIED_ANCHOR_SHA256');
    process.exitCode=2;
  } else {
    try {
      console.log(JSON.stringify(capture({
        source:process.argv[2],directory:process.argv[3],
        anchorBytes:process.argv[4],anchorSha256:process.argv[5]
      }),null,2));
    } catch (error) {
      console.error('Legacy history capture blocked:',error.message);
      process.exitCode=1;
    }
  }
}
module.exports={capture};

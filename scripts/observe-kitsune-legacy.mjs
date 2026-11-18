#!/usr/bin/env node
/**
 * Read-only observer for the Kitsune Desktop Commander stdio cutover.
 * Does not change connections, invoke Desktop Commander commands, or read
 * historical command bodies. No automatic process retirement.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_OLD = 'dc-i9es-opaque-publisher';
const DEFAULT_NEW = 'dc-i9es-stdio-opaque';

export function parseConnection(text, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('^\\s*' + escaped + '\\s*\\|\\s*PID\\s+(\\d+)\\s*\\|[^\\n]*?\\bcalls:\\s*(\\d+)', 'm');
  const match = String(text).match(rx);
  return match ? { pid: Number(match[1]), calls: Number(match[2]) } : null;
}

export function makeObservation(text, legacyFile, timestamp = new Date().toISOString()) {
  let file = null;
  try {
    const s = fs.statSync(legacyFile, { bigint: true });
    file = { inode: s.ino.toString(), bytes: Number(s.size), mtimeNs: s.mtimeNs.toString() };
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  return {
    at: timestamp,
    legacyAlias: parseConnection(text, DEFAULT_OLD),
    upgradedAlias: parseConnection(text, DEFAULT_NEW),
    legacyHistory: file,
    // A stable count does not establish that no other client still depends on this alias.
    retirementAuthorized: false
  };
}

// Last observation is small (<1KB). Bound disk reads even after years of runs.
export function readLastObservation(filename) {
  let fd;
  try {
    fd = fs.openSync(filename, 'r');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return null;
    const length = Math.min(size, 8192);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n').filter(Boolean);
    if (size > length) lines.shift(); // first line may be incomplete
    if (!lines.length) throw Error('No complete prior observation');
    return JSON.parse(lines.at(-1));
  } finally {
    fs.closeSync(fd);
  }
}

export function compareActivity(current, previous) {
  const old = current.legacyAlias;
  const prevOld = previous?.legacyAlias;
  const currentFile = current.legacyHistory;
  const previousFile = previous?.legacyHistory;
  const stablePid = old && prevOld && old.pid === prevOld.pid;
  const stableInode = currentFile && previousFile && currentFile.inode === previousFile.inode;
  const callDelta = stablePid ? old.calls - prevOld.calls : null;
  const historyBytesDelta = stableInode ? currentFile.bytes - previousFile.bytes : null;
  const callsIncreased = callDelta !== null && callDelta > 0;
  const fileGrew = historyBytesDelta !== null && historyBytesDelta > 0;
  const baselineChanged = Boolean(previous && (
    !stablePid || !stableInode || callDelta < 0 || historyBytesDelta < 0
  ));
  return {
    ...current,
    comparedTo: previous?.at || null,
    legacyCallsDelta: callDelta,
    legacyHistoryBytesDelta: historyBytesDelta,
    legacyActivityDetected: !previous || baselineChanged ? null : (callsIncreased || fileGrew),
    lastObservedLegacyActivityAt: callsIncreased || fileGrew
      ? current.at : (previous?.lastObservedLegacyActivityAt || null),
    // A PID reset or changed file identity invalidates the prior baseline.
    baselineChanged,
    retirementAuthorized: false,
  };
}

export async function observe() {
  // Dynamic import keeps tests of the parser independent of MCP SDK installs.
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  ]);
  const client = new Client({ name: 'dc-legacy-alias-observer', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:19983/mcp'));
  let status;
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'status', arguments: {} });
    if (response.isError) throw Error('Kitsune status MCP call failed');
    status = (response.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  } finally {
    await client.close().catch(() => {});
  }
  if (!status.includes('PERSISTENT CONNECTIONS')) throw Error('Unexpected Kitsune status format');
  const configDir = path.join(os.homedir(), '.claude-server-commander');
  const fresh = makeObservation(status, path.join(configDir, 'tool-history.jsonl'));
  if (!fresh.upgradedAlias) throw Error('Upgraded Kitsune stdio alias missing');
  const filename = path.join(configDir, 'legacy-alias-observer.jsonl');
  const previous = readLastObservation(filename);
  const observation = compareActivity(fresh, previous);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, 'a', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(observation) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filename, 0o600);
  return observation;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  observe().then(data => {
    console.log(JSON.stringify(data));
  }).catch(err => {
    console.error('dc-legacy-alias-observer failed:', err?.message || String(err));
    process.exitCode = 1;
  });
}

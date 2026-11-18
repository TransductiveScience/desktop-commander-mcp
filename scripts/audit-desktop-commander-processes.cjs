#!/usr/bin/env node
'use strict';

/**
 * Read-only i9ES Desktop Commander connection inventory.
 * Lists candidate history writers without exposing arguments, process
 * environments, credentials or tool-history contents.
 * A process with an ordinary HOME and no override is only a *candidate*
 * legacy writer. No open-call or session-drain guarantee follows from /proc.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function classify({ command, home, override, principalHome = '/home/ned' }) {
  const normalized = (command || '').toLowerCase();
  // Match the actual Node server entrypoint, not an npm wrapper, Git
  // utility, Docker command or inventory script merely mentioning a path.
  const isNode = /(?:^|\s)(?:\/[^\s]+\/)?node(?:\s|$)/.test(normalized);
  const isServer = /(?:\/dist\/index\.js|\/scripts\/start-http-server\.js|\/\.bin\/desktop-commander)(?:\s|$)/.test(normalized);
  if (!isNode || !isServer) return null;
  if (override) return 'isolated-override';
  if (home.startsWith('/tmp/') || home === '/tmp') return 'temporary-probe';
  if (home === principalHome) return 'shared-history-candidate';
  return 'other-home';
}
function textFile(name) {
  try { return fs.readFileSync(name); } catch { return null; }
}
function run(root='/proc', principalHome=os.homedir()) {
  const items=[];
  for (const pid of fs.readdirSync(root)) {
    if (!/^\d+$/.test(pid)) continue;
    const base=path.join(root,pid);
    const bytes=textFile(path.join(base,'cmdline'));
    if (!bytes) continue;
    const argv=bytes.toString('utf8').split('\u0000').filter(Boolean);
    const command=argv.join(' ');
    if (!/desktop-commander|desktopcommander/i.test(command)) continue;
    const envBytes=textFile(path.join(base,'environ'));
    if (!envBytes) continue;
    const env=envBytes.toString('utf8').split('\u0000').filter(Boolean);
    const home=(env.find(x=>x.startsWith('HOME='))||'').slice(5);
    const override=(env.find(x=>x.startsWith('DESKTOP_COMMANDER_TOOL_HISTORY_FILE='))||'').split('=').slice(1).join('=');
    const category=classify({command,home,override,principalHome});
    if (!category) continue;
    const status=textFile(path.join(base,'status'))?.toString('utf8')||'';
    const parentMatch=status.match(/^PPid:\s*(\d+)/m);
    items.push({
      pid:Number(pid),
      parentPid:parentMatch?Number(parentMatch[1]):null,
      category,
      processKind:/\bnode\b|node-mainthread|\bdist\/index\.js\b/i.test(command)?'node':
        /npm exec/i.test(command)?'npm-launcher':'other',
      // Explicitly omit environment values, arguments, file contents, and cwd.
      historyOverridePresent:!!override,
    });
  }
  items.sort((a,b)=>a.pid-b.pid);
  const counts=Object.fromEntries(['shared-history-candidate','isolated-override','temporary-probe','other-home'].map(
    type=>[type,items.filter(x=>x.category===type).length]));
  return {observedAt:new Date().toISOString(),host:os.hostname(),counts,items,
    limitation:'Candidates are not proven active writers. Do not kill/reload based solely on this inventory.'};
}
if (require.main===module) {
  console.log(JSON.stringify(run(),null,2));
}
module.exports={classify,run};

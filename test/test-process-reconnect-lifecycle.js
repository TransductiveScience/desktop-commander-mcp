import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { configManager } from '../dist/config-manager.js';
import { terminalManager } from '../dist/terminal-manager.js';
import {
  listSessions,
  readProcessOutput,
  startProcess,
} from '../dist/tools/improved-process-tools.js';
import { handleStartProcess } from '../dist/handlers/terminal-handlers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (result) => result?.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || '';
const extractPid = (result) => Number(text(result).match(/PID\s+(\d+)/)?.[1]);

async function waitForCompletion(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readProcessOutput({ pid, offset: -50, length: 50, timeout_ms: 100 });
    if (text(result).includes('Process completed')) return result;
    await sleep(100);
  }
  throw new Error(`process ${pid} did not complete in ${timeoutMs}ms`);
}

async function main() {
  const originalCap = await configManager.getValue('maxProcessWaitMs');
  let pid = -1;
  try {
    await configManager.setValue('maxProcessWaitMs', 300);

    const invalid = await handleStartProcess({ command: 'echo missing-timeout' });
    assert.equal(invalid.isError, true, 'invalid start_process arguments should be a tool result, not a thrown internal error');
    assert.match(text(invalid), /Invalid arguments.*timeout_ms/s, 'tool error should preserve its validation cause');

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const command = `node -e "let i=0;console.log('LIFECYCLE_START');const t=setInterval(()=>console.log('LIFECYCLE_TICK '+(++i)),350);setTimeout(()=>{clearInterval(t);console.log('LIFECYCLE_FINAL');process.exit(7)},2400)"`;
    const startedAt = Date.now();
    const started = await startProcess({ command, shell, timeout_ms: 60000 });
    pid = extractPid(started);

    assert(pid > 0, 'start_process must hand back a stable PID');
    assert(Date.now() - startedAt < 5000, '60s caller timeout must not hold the connector call');
    assert.equal(terminalManager.listActiveSessions().filter((session) => session.pid === pid).length, 1, 'child must be registered exactly once');

    await readProcessOutput({ pid, offset: 0, length: 50, timeout_ms: 100 });

    // Model a connector abandoning a pending read. The server-side operation is
    // deliberately left alive, just like an HTTP/tool-call timeout.
    const abandonedRead = readProcessOutput({ pid, offset: 0, length: 50, timeout_ms: 60000 });
    const connectorOutcome = await Promise.race([
      abandonedRead.then(() => 'response'),
      sleep(40).then(() => 'connector-timeout'),
    ]);
    assert.equal(connectorOutcome, 'connector-timeout', 'fixture must exercise an abandoned in-flight read');

    await sleep(700);
    await abandonedRead;
    assert.equal(terminalManager.listActiveSessions().filter((session) => session.pid === pid).length, 1, 'abandoned read must not kill or duplicate the child');

    // A reconnect can resume deterministically with the existing absolute
    // offset contract even if the abandoned response advanced offset=0.
    const resumed = await readProcessOutput({ pid, offset: 1, length: 50, timeout_ms: 100 });
    assert.equal(resumed.isError, undefined, 'reconnected read should succeed');
    assert.match(text(resumed), /LIFECYCLE_TICK/, 'reconnected read should recover incremental output without restarting');
    assert.match(text(await listSessions()), new RegExp(`PID: ${pid}\\b`), 'same stable process identity must remain discoverable');

    const completed = await waitForCompletion(pid);
    assert.match(text(completed), /LIFECYCLE_FINAL/, 'final output must remain retrievable');
    assert.match(text(completed), /exit code 7/, 'final exit code must remain retrievable');
    assert.equal(terminalManager.listActiveSessions().filter((session) => session.pid === pid).length, 0, 'completed child must leave the active registry exactly once');

    const replay = await readProcessOutput({ pid, offset: 1, length: 50, timeout_ms: 100 });
    assert.match(text(replay), /LIFECYCLE_FINAL/, 'completed output must remain re-attachable');
    assert.match(text(replay), /exit code 7/, 'completed exit status must survive reconnect');

    if (process.platform === 'win32') {
      const installer = await fs.readFile(new URL('../Install-DesktopCommander-Edge.ps1', import.meta.url), 'utf8');
      const launcher = await fs.readFile(new URL('../scripts/start-http-server.js', import.meta.url), 'utf8');
      assert.match(installer, /LogonType Interactive/, 'Windows task must use the interactive user token');
      assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn -User \$taskUser/, 'Windows task must restart for that user at logon');
      assert.doesNotMatch(installer, /-UserId "SYSTEM"/, 'installer must not regress to SYSTEM execution');
      assert.doesNotMatch(launcher, /C:\\\\Users\\\\Admin/, 'launcher must not hard-code an unrelated HOME profile');
      assert.match(
        launcher,
        /path\.join\(worktree, 'scripts', 'jwt-verifier\.js'\)/,
        'OAuth verifier path must not depend on the scheduled task working directory',
      );
    }

    console.log(`PROCESS_RECONNECT_LIFECYCLE_PASS pid=${pid} exit=7`);
  } finally {
    if (pid > 0 && terminalManager.getSession(pid)) terminalManager.forceTerminate(pid);
    await configManager.setValue('maxProcessWaitMs', originalCap);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

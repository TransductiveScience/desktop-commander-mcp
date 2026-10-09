import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listProcesses } from '../../dist/tools/process.js';
import { inspectWindowsProcess, setWindowsProcessPolicy } from '../../dist/tools/windows-process-control.js';

const receipt = { task: 'WINDOWS_PROCESS_CONTROL_VERIFY', date: new Date().toISOString(), tests: [] };
const check = (name, pass, detail = '') => { receipt.tests.push({ name, pass, detail }); assert.ok(pass, name + ': ' + detail); };
try {
  const listing = await listProcesses();
  check('list-not-error', !listing.isError);
  check('list-numeric-pids', !listing.content[0].text.includes('PID: NaN'));
  const info = await inspectWindowsProcess({ pid: process.pid, sample_ms: 300 });
  check('inspection-not-error', !info.isError, info.content[0].text.slice(0, 300));
  const state = JSON.parse(info.content[0].text);
  check('pid-identity', state.pid === process.pid);
  check('sampled-cpu', Number.isFinite(state.cpu_percent));
  check('metrics', state.working_set_bytes > 0 && state.thread_count > 0);
  const plan = await setWindowsProcessPolicy({ pid: process.pid, expected_start_utc: state.start_utc, priority: 'normal' });
  check('dry-run', !plan.isError && JSON.parse(plan.content[0].text).dry_run, plan.content[0].text.slice(0, 200));
  const stale = await setWindowsProcessPolicy({ pid: process.pid, expected_start_utc: '2000-01-01T00:00:00.0000000Z', priority: 'normal', dry_run: false });
  check('stale-pid-fence', Boolean(stale.isError));
  const originalPriority = ({ Idle:'idle', BelowNormal:'below_normal', Normal:'normal', AboveNormal:'above_normal', High:'high' })[state.priority];
  check('supported-own-priority', Boolean(originalPriority), state.priority);
  let applied = false;
  try {
    const update = await setWindowsProcessPolicy({ pid: process.pid, expected_start_utc: state.start_utc, priority: 'normal', dry_run: false });
    applied = !update.isError;
    check('apply-own-priority', applied && JSON.parse(update.content[0].text).after.priority === 'Normal', update.content[0].text.slice(0, 240));
  } finally {
    if (applied) {
      const restore = await setWindowsProcessPolicy({ pid: process.pid, expected_start_utc: state.start_utc, priority: originalPriority, dry_run: false });
      check('restore-own-priority', !restore.isError && JSON.parse(restore.content[0].text).after.priority === state.priority, restore.content[0].text.slice(0, 240));
    }
  }
  receipt.ok = true;
} catch (error) { receipt.ok = false; receipt.error = String(error); }
fs.writeFileSync('E:\\desktop-commander-mcp\\logs\\windows-process-control-test.json', JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
if (!receipt.ok) process.exitCode = 1;

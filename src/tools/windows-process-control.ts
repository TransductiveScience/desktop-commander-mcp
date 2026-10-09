import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ServerResult } from '../types.js';
import { InspectWindowsProcessArgsSchema, SetWindowsProcessPolicyArgsSchema } from './schemas.js';

const runFile = promisify(execFile);
const result = (value: unknown, isError = false): ServerResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

async function powerShellJson(lines: string[]): Promise<any> {
  if (os.platform() !== 'win32') throw new Error('Windows process control requires a Windows host');
  const script = lines.join('\r\n');
  const { stdout } = await runFile('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], { windowsHide: true, timeout: 20000, maxBuffer: 2_000_000 });
  const output = stdout.trim();
  if (!output) throw new Error('PowerShell returned no process data');
  return JSON.parse(output);
}

export async function inspectWindowsProcess(input: unknown): Promise<ServerResult> {
  const parsed = InspectWindowsProcessArgsSchema.safeParse(input);
  if (!parsed.success) return result(parsed.error.message, true);
  const { pid, sample_ms } = parsed.data;
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$pidNum = ' + pid,
    '$a = Get-Process -Id $pidNum -ErrorAction Stop',
    "$start = $a.StartTime.ToUniversalTime().ToString('o')",
    '$cpuA = [double]$a.CPU',
    '$sampleClock = [Diagnostics.Stopwatch]::StartNew()',
    'Start-Sleep -Milliseconds ' + sample_ms,
    '$b = Get-Process -Id $pidNum -ErrorAction Stop',
    '$sampleClock.Stop()',
    "if ($b.StartTime.ToUniversalTime().ToString('o') -ne $start) { throw 'Process identity changed during sampling' }",
    '$cpuB = [double]$b.CPU',
    '$cpuDelta = [Math]::Max(0, ($cpuB - $cpuA))',
    '$cpuOneCore = [Math]::Round(100 * $cpuDelta / [Math]::Max(0.001, $sampleClock.Elapsed.TotalSeconds), 2)',
    '$cpuTotal = [Math]::Round($cpuOneCore / [Environment]::ProcessorCount, 2)',
    '$cim = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $pidNum) -ErrorAction SilentlyContinue',
  ];
  lines.push('[pscustomobject]@{');
  lines.push('pid=$pidNum; name=$b.ProcessName; start_utc=$start; cpu_percent=$cpuTotal; cpu_one_core_percent=$cpuOneCore; cpu_total_seconds=[double]$b.CPU');
  lines.push('working_set_bytes=[long]$b.WorkingSet64; private_bytes=[long]$b.PrivateMemorySize64; handle_count=$b.HandleCount; thread_count=$b.Threads.Count');
  lines.push('priority=[string]$b.PriorityClass; affinity_mask=$b.ProcessorAffinity.ToInt64(); parent_pid=$cim.ParentProcessId; session_id=$b.SessionId');
  lines.push('} | ConvertTo-Json -Depth 4 -Compress');
  try {
    return result(await powerShellJson(lines));
  } catch (error) {
    return result('Process inspection failed: ' + String(error), true);
  }
}

export async function setWindowsProcessPolicy(input: unknown): Promise<ServerResult> {
  const parsed = SetWindowsProcessPolicyArgsSchema.safeParse(input);
  if (!parsed.success) return result(parsed.error.message, true);
  const { pid, expected_start_utc, priority, affinity_mask, dry_run } = parsed.data;
  if (priority === undefined && affinity_mask === undefined) {
    return result('Specify a priority or affinity_mask', true);
  }
  const levels: Record<string, string> = {
    idle: 'Idle', below_normal: 'BelowNormal', normal: 'Normal',
    above_normal: 'AboveNormal', high: 'High',
  };
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$p = Get-Process -Id ' + pid + ' -ErrorAction Stop',
    "$actual = $p.StartTime.ToUniversalTime().ToString('o')",
    "if ($actual -ne '" + expected_start_utc + "') { throw 'Stale target: PID creation timestamp mismatch' }",
    '$before = [pscustomobject]@{ priority=[string]$p.PriorityClass; affinity_mask=$p.ProcessorAffinity.ToInt64() }',
  ];
  if (!dry_run) {
    if (priority !== undefined) lines.push('$p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::' + levels[priority]);
    if (affinity_mask !== undefined) lines.push('$p.ProcessorAffinity = [IntPtr]::new([int64]' + affinity_mask + ')');
    lines.push('$p.Refresh()');
  }
  lines.push('$after = [pscustomobject]@{ priority=[string]$p.PriorityClass; affinity_mask=$p.ProcessorAffinity.ToInt64() }');
  if (!dry_run) {
    if (priority !== undefined) lines.push("if ($after.priority -ne '" + levels[priority] + "') { throw 'Priority postcondition failed' }");
    if (affinity_mask !== undefined) lines.push('if ($after.affinity_mask -ne ' + affinity_mask + ") { throw 'Affinity postcondition failed' }");
  }
  lines.push('[pscustomobject]@{ pid=' + pid + '; start_utc=$actual; dry_run=$' + (dry_run ? 'true' : 'false') + '; before=$before; after=$after } | ConvertTo-Json -Depth 4 -Compress');
  try {
    return result(await powerShellJson(lines));
  } catch (error) {
    return result('Process policy change failed: ' + String(error), true);
  }
}

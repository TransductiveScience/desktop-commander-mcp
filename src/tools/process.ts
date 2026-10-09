import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { ServerResult } from '../types.js';
import { KillProcessArgsSchema } from './schemas.js';

const execFileAsync = promisify(execFile);

export async function listProcesses(): Promise<ServerResult> {
  try {
    let lines: string[];
    if (os.platform() === 'win32') {
      const script = [
        'Get-Process | Sort-Object WorkingSet64 -Descending',
        '| Select-Object -First 100 Id,ProcessName,CPU,WorkingSet64,PrivateMemorySize64,HandleCount,@{Name="Threads";Expression={$_.Threads.Count}}',
        '| ConvertTo-Json -Compress',
      ].join(' ');
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', script,
      ], { windowsHide: true, timeout: 20000, maxBuffer: 1_500_000 });
      const parsed = JSON.parse(stdout.trim());
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      lines = rows.map((p: any) =>
        'PID: ' + p.Id + ', Name: ' + p.ProcessName +
        ', CPU_total_s: ' + Number(p.CPU || 0).toFixed(1) +
        ', RAM_MB: ' + (Number(p.WorkingSet64 || 0) / 1048576).toFixed(1) +
        ', Private_MB: ' + (Number(p.PrivateMemorySize64 || 0) / 1048576).toFixed(1) +
        ', Threads: ' + p.Threads + ', Handles: ' + p.HandleCount);
    } else {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm=,%cpu=,rss='], { maxBuffer: 1_500_000 });
      lines = stdout.trim().split(/\r?\n/).slice(0, 200).map(line => {
        const parts = line.trim().split(/\s+/);
        return 'PID: ' + parts[0] + ', Name: ' + parts[1] +
          ', CPU_pct: ' + parts[2] + ', RSS_KB: ' + parts[3];
      });
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: 'Error: Failed to list processes: ' +
        (error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

export async function killProcess(args: unknown): Promise<ServerResult> {
  const parsed = KillProcessArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid arguments for kill_process: ' + parsed.error }],
      isError: true,
    };
  }
  try {
    process.kill(parsed.data.pid);
    return { content: [{ type: 'text', text: 'Successfully terminated process ' + parsed.data.pid }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: 'Error: Failed to kill process: ' +
        (error instanceof Error ? error.message : String(error)) }],
      isError: true,
    };
  }
}

import { 
    listProcesses,
    killProcess
} from '../tools/process.js';

import { 
    KillProcessArgsSchema
} from '../tools/schemas.js';

import { ServerResult } from '../types.js';
import { inspectWindowsProcess, setWindowsProcessPolicy } from '../tools/windows-process-control.js';

/**
 * Handle list_processes command
 */
export async function handleListProcesses(): Promise<ServerResult> {
    return listProcesses();
}

/**
 * Handle kill_process command
 */
export async function handleKillProcess(args: unknown): Promise<ServerResult> {
    const parsed = KillProcessArgsSchema.parse(args);
    return killProcess(parsed);
}

export async function handleInspectWindowsProcess(args: unknown): Promise<ServerResult> {
    return inspectWindowsProcess(args);
}

export async function handleSetWindowsProcessPolicy(args: unknown): Promise<ServerResult> {
    return setWindowsProcessPolicy(args);
}

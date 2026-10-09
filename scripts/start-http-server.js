import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const worktree = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const logsDirectory = path.join(worktree, 'logs');
fs.mkdirSync(logsDirectory, { recursive: true });

function teeStream(stream, filename) {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
        try {
            fs.appendFileSync(path.join(logsDirectory, filename), chunk);
        } catch {}
        return originalWrite(chunk, encoding, callback);
    };
}

teeStream(process.stdout, 'http-service.stdout.log');
teeStream(process.stderr, 'http-service.stderr.log');

function appendRuntimeLog(level, value) {
    const rendered = value?.stack || String(value);
    try {
        fs.appendFileSync(
            path.join(logsDirectory, 'http-service.runtime.log'),
            `[${new Date().toISOString()}] ${level}: ${rendered}\n`,
        );
    } catch {}
}

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

process.on('uncaughtException', (error) => {
    appendRuntimeLog('Uncaught exception', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    appendRuntimeLog('Unhandled rejection', reason);
    process.exit(1);
});

async function main() {
    // Keep all home/profile variables bound to the task's real Windows user.
    // Mixing a hard-coded HOME with SYSTEM's USERPROFILE/APPDATA makes
    // user-scoped CLIs read credentials from different accounts.
    if (!process.env.HOME && process.env.USERPROFILE) {
        process.env.HOME = process.env.USERPROFILE;
    }
    process.env.DESKTOP_COMMANDER_HTTP_HOST = argumentValue('--host') || process.env.DESKTOP_COMMANDER_HTTP_HOST || '127.0.0.1';
    process.env.DESKTOP_COMMANDER_HTTP_PORT = argumentValue('--port') || process.env.DESKTOP_COMMANDER_HTTP_PORT || '9180';
    const fallbackPort = argumentValue('--process-fallback-port') || process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT;
    if (/^\d+$/.test(fallbackPort || '') && Number(fallbackPort) >= 1 && Number(fallbackPort) <= 65535) {
        process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT = fallbackPort;
    } else {
        delete process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT;
    }
    process.env.DESKTOP_COMMANDER_HTTP_AUTH = process.env.DESKTOP_COMMANDER_HTTP_AUTH || 'oauth';
    process.env.DESKTOP_COMMANDER_OAUTH_ISSUER = process.env.DESKTOP_COMMANDER_OAUTH_ISSUER || 'https://desktopcommander-auth.seyferthfriso.workers.dev';
    process.env.DESKTOP_COMMANDER_OAUTH_VERIFIER_MODULE = process.env.DESKTOP_COMMANDER_OAUTH_VERIFIER_MODULE
        || path.join(worktree, 'scripts', 'jwt-verifier.js');
    process.env.DESKTOP_COMMANDER_PUBLIC_BASE_URL = process.env.DESKTOP_COMMANDER_PUBLIC_BASE_URL || 'https://desktopcommander.transductive.art';
    process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';

    // Runtime modules must observe the service environment during evaluation.
    const { runHttpServer } = await import('../dist/http/index.js');
    await runHttpServer();
    const identity = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join('\\');
    appendRuntimeLog('Started', `pid=${process.pid} identity=${identity || 'unknown'} worktree=${worktree}`);
    setInterval(() => {}, 60000);
}

main().catch(err => {
    appendRuntimeLog('Fatal main error', err);
    process.exit(1);
});

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

process.on('uncaughtException', (error) => {
    appendRuntimeLog('Uncaught exception', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    appendRuntimeLog('Unhandled rejection', reason);
    process.exit(1);
});

async function main() {
    process.env.USERPROFILE = process.env.USERPROFILE || 'C:\\Users\\Admin';
    process.env.HOME = process.env.HOME || 'C:\\Users\\Admin';
    process.env.DESKTOP_COMMANDER_HTTP_HOST = process.env.DESKTOP_COMMANDER_HTTP_HOST || '127.0.0.1';
    process.env.DESKTOP_COMMANDER_HTTP_PORT = process.env.DESKTOP_COMMANDER_HTTP_PORT || '9180';
    process.env.DESKTOP_COMMANDER_HTTP_AUTH = process.env.DESKTOP_COMMANDER_HTTP_AUTH || 'oauth';
    process.env.DESKTOP_COMMANDER_OAUTH_ISSUER = process.env.DESKTOP_COMMANDER_OAUTH_ISSUER || 'https://desktopcommander-auth.seyferthfriso.workers.dev';
    process.env.DESKTOP_COMMANDER_OAUTH_VERIFIER_MODULE = process.env.DESKTOP_COMMANDER_OAUTH_VERIFIER_MODULE || './scripts/jwt-verifier.js';
    process.env.DESKTOP_COMMANDER_PUBLIC_BASE_URL = process.env.DESKTOP_COMMANDER_PUBLIC_BASE_URL || 'https://desktopcommander.transductive.art';
    process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';

    // Runtime modules must observe the service environment during evaluation.
    const { runHttpServer } = await import('../dist/http/index.js');
    await runHttpServer();
    appendRuntimeLog('Started', `pid=${process.pid} worktree=${worktree}`);
    setInterval(() => {}, 60000);
}

main().catch(err => {
    appendRuntimeLog('Fatal main error', err);
    process.exit(1);
});

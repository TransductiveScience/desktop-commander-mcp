import type { ServerResult } from '../types.js';
import { getHttpRequestAccessToken } from '../http/request-context.js';

let requestId = 0;

function configuredFallbackUrl(): URL | null {
    const raw = process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL;
    const port = process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT;
    if (!raw && !port) return null;
    if (!raw) {
        if (!/^\d+$/.test(port!) || Number(port) < 1 || Number(port) > 65535) {
            return null;
        }
        return new URL(`http://127.0.0.1:${port}/mcp`);
    }
    const url = new URL(raw);
    const loopback = ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'http:' || !loopback) {
        throw new Error('DESKTOP_COMMANDER_PROCESS_FALLBACK_URL must be an HTTP loopback URL');
    }
    return url;
}

export function hasProcessFallback(): boolean {
    return Boolean(
        process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL
        || process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT,
    );
}

export async function callProcessFallback(name: string, args: unknown): Promise<ServerResult | null> {
    const url = configuredFallbackUrl();
    if (!url) return null;

    const accessToken = getHttpRequestAccessToken();
    const headers: Record<string, string> = {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `process-fallback-${process.pid}-${++requestId}`,
            method: 'tools/call',
            params: { name, arguments: args ?? {} },
        }),
        signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json() as {
        result?: ServerResult;
        error?: { message?: string; data?: { cause?: string } };
    };
    if (!response.ok || payload.error) {
        const cause = payload.error?.data?.cause || payload.error?.message || `HTTP ${response.status}`;
        throw new Error(`legacy process fallback ${name} failed: ${cause}`);
    }
    if (!payload.result) throw new Error(`legacy process fallback ${name} returned no result`);
    return payload.result;
}

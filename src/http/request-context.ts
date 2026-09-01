import { AsyncLocalStorage } from 'node:async_hooks';

export interface HttpRequestContext {
    accessToken?: string;
}

const httpRequestContext = new AsyncLocalStorage<HttpRequestContext>();

export function runWithHttpRequestContext<T>(context: HttpRequestContext, operation: () => T): T {
    return httpRequestContext.run(context, operation);
}

export function getHttpRequestAccessToken(): string | undefined {
    return httpRequestContext.getStore()?.accessToken;
}

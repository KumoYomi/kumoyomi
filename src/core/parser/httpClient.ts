import {
  clearAllSiteTabProxyHints,
  clearSiteTabProxied,
  isSiteTabProxied,
  markSiteTabProxied,
  requestTabProxyFetch,
} from '@/src/core/extension/browserBridge';
import type { RequestConfig, SourceConfig } from '@/src/core/types/source';

export class CloudflareChallengeError extends Error {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly url: string;
  readonly status: number;
  readonly reason?: 'no_tab' | 'tab_blocked';

  constructor(params: {
    sourceId: string;
    sourceName: string;
    url: string;
    status: number;
    reason?: 'no_tab' | 'tab_blocked';
  }) {
    const suffix =
      params.reason === 'tab_blocked'
        ? " (l'onglet ouvert renvoie lui aussi un blocage Cloudflare : rechargez-le avec F5)"
        : params.reason === 'no_tab'
          ? ' (aucun onglet ouvert trouvé sur ce domaine)'
          : '';
    super(
      `Protection Cloudflare / anti-bot détectée sur ${params.sourceName} (HTTP ${params.status})${suffix}.`,
    );
    this.name = 'CloudflareChallengeError';
    this.sourceId = params.sourceId;
    this.sourceName = params.sourceName;
    this.url = params.url;
    this.status = params.status;
    this.reason = params.reason;
  }
}

export class SourceHttpError extends Error {
  readonly sourceId: string;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;

  constructor(params: {
    sourceId: string;
    url: string;
    status: number;
    statusText: string;
    message?: string;
  }) {
    super(params.message ?? `Erreur HTTP ${params.status} (${params.statusText}) sur ${params.url}`);
    this.name = 'SourceHttpError';
    this.sourceId = params.sourceId;
    this.url = params.url;
    this.status = params.status;
    this.statusText = params.statusText;
  }
}

export interface TemplateVariables {
  baseUrl: string;
  page?: number;
  query?: string;
  mangaUrl?: string;
  chapterUrl?: string;
  vars?: Record<string, string>;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function extractLastSlug(urlOrPath: string): string {
  if (!urlOrPath) return '';
  try {
    const parsed = new URL(urlOrPath, 'https://placeholder.invalid');
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.at(-1) ?? '';
  } catch {
    const clean = urlOrPath.split(/[?#]/)[0] ?? '';
    const parts = clean.split('/').filter(Boolean);
    return parts.at(-1) ?? '';
  }
}

export function interpolateTemplate(template: string, variables: TemplateVariables): string {
  const cleanBase = variables.baseUrl.replace(/\/+$/, '');
  const page = variables.page ?? 1;
  const query = variables.query ?? '';
  const mangaUrl = variables.mangaUrl ?? '';
  const chapterUrl = variables.chapterUrl ?? '';

  const replacements: Record<string, string> = {
    baseUrl: cleanBase,
    page: String(page),
    pageZero: String(Math.max(0, page - 1)),
    query,
    encodedQuery: encodeURIComponent(query),
    mangaUrl,
    mangaUrlSlash: mangaUrl ? ensureTrailingSlash(mangaUrl) : '',
    mangaSlug: extractLastSlug(mangaUrl),
    chapterUrl,
    chapterUrlSlash: chapterUrl ? ensureTrailingSlash(chapterUrl) : '',
    chapterSlug: extractLastSlug(chapterUrl),
  };

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key.startsWith('vars.')) {
      const varName = key.slice(5);
      return variables.vars?.[varName] ?? '';
    }
    return replacements[key] ?? '';
  });
}

function interpolateUnknown(value: unknown, variables: TemplateVariables): unknown {
  if (typeof value === 'string') {
    return interpolateTemplate(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateUnknown(v, variables));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateUnknown(v, variables);
    }
    return out;
  }
  return value;
}

export function clearTabProxyCache(): void {
  clearAllSiteTabProxyHints();
}

export function isCloudflareResponse(status: number, headers: Headers, bodyText: string): boolean {
  if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
    return true;
  }
  if (status === 403 || status === 503 || status === 429) {
    const lower = bodyText.toLowerCase();
    if (
      lower.includes('<title>just a moment...</title>') ||
      lower.includes('<title>un instant...</title>') ||
      lower.includes('challenges.cloudflare.com') ||
      lower.includes('/cdn-cgi/challenge-platform/') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('enable javascript and cookies to continue') ||
      lower.includes('_cf_chl_opt')
    ) {
      return true;
    }
  }
  return false;
}

export interface FetchedResponse {
  text: string;
  json: unknown;
  finalUrl: string;
  status: number;
}

interface TransportResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Headers;
}

function serializeHeadersInit(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function safeOrigin(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

async function tryFetchViaOpenTab(
  url: string,
  init: RequestInit,
  source: SourceConfig,
  timeoutMs: number,
): Promise<{ response: TransportResponse; text: string } | null> {
  const res = await requestTabProxyFetch({
    url,
    method: init.method ?? 'GET',
    headers: serializeHeadersInit(init.headers),
    body: typeof init.body === 'string' ? init.body : undefined,
    responseMode: 'text',
    timeoutMs,
    fallbackTabOrigin: safeOrigin(source.baseUrl),
  });

  if (!res?.foundTab) {
    return null;
  }

  if (res.error) {
    throw new SourceHttpError({
      sourceId: source.id,
      url,
      status: 0,
      statusText: 'Tab Proxy Error',
      message: `Impossible de joindre ${source.name} depuis l'onglet ouvert (${res.error}).`,
    });
  }

  const headers = new Headers(res.headers ?? {});
  const status = res.status ?? 0;
  return {
    response: {
      ok: Boolean(res.ok),
      status,
      statusText: res.statusText ?? '',
      url: res.finalUrl || url,
      headers,
    },
    text: res.bodyText ?? '',
  };
}

function throwCloudflareError(
  source: SourceConfig,
  status: number,
  reason?: 'no_tab' | 'tab_blocked',
): never {
  throw new CloudflareChallengeError({
    sourceId: source.id,
    sourceName: source.name,
    url: source.baseUrl,
    status,
    reason,
  });
}

async function fetchViaOpenTabWithRetry(
  url: string,
  init: RequestInit,
  source: SourceConfig,
  timeoutMs: number,
): Promise<{ response: TransportResponse; text: string } | null> {
  const first = await tryFetchViaOpenTab(url, init, source, timeoutMs);
  if (!first) return null;
  if (!isCloudflareResponse(first.response.status, first.response.headers, first.text)) {
    return first;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return tryFetchViaOpenTab(url, init, source, timeoutMs);
}

async function executeTimedFetch(
  url: string,
  init: RequestInit,
  source: SourceConfig,
  timeoutMs: number,
): Promise<{ response: TransportResponse; text: string }> {
  if (isSiteTabProxied(url)) {
    const proxied = await fetchViaOpenTabWithRetry(url, init, source, timeoutMs);
    if (proxied) {
      if (isCloudflareResponse(proxied.response.status, proxied.response.headers, proxied.text)) {
        throwCloudflareError(source, proxied.response.status, 'tab_blocked');
      }
      markSiteTabProxied(url);
      return proxied;
    }
    clearSiteTabProxied(url);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SourceHttpError({
        sourceId: source.id,
        url,
        status: 408,
        statusText: 'Timeout',
        message: `Délai dépassé (${timeoutMs / 1000}s) lors de la connexion à ${source.name}.`,
      });
    }
    throw new SourceHttpError({
      sourceId: source.id,
      url,
      status: 0,
      statusText: 'Network Error',
      message: `Impossible de joindre ${source.name} (${err instanceof Error ? err.message : 'Erreur réseau'}).`,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (isCloudflareResponse(response.status, response.headers, text)) {
    // Repli automatique sur un onglet déjà ouvert et débloqué du même site (cookies partitionnés / Sec-Fetch-Site)
    const proxied = await fetchViaOpenTabWithRetry(url, init, source, timeoutMs);
    if (proxied && !isCloudflareResponse(proxied.response.status, proxied.response.headers, proxied.text)) {
      markSiteTabProxied(url);
      return proxied;
    }
    throwCloudflareError(
      source,
      proxied?.response.status ?? response.status,
      proxied ? 'tab_blocked' : 'no_tab',
    );
  }

  return {
    response: {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || url,
      headers: response.headers,
    },
    text,
  };
}

interface PreparedSourceRequest {
  url: string;
  init: RequestInit;
  responseType: 'html' | 'json' | 'json-html';
  cacheKey: string;
}

function prepareSourceRequest(
  source: SourceConfig,
  reqConfig: RequestConfig,
  vars: Partial<TemplateVariables> = {},
): PreparedSourceRequest {
  const fullVars: TemplateVariables = {
    baseUrl: source.baseUrl,
    vars: source.vars,
    ...vars,
  };

  const rawUrl = interpolateTemplate(reqConfig.url, fullVars);
  const urlObj = new URL(rawUrl, ensureTrailingSlash(source.baseUrl));

  if (reqConfig.queryParams) {
    for (const [key, tplVal] of Object.entries(reqConfig.queryParams)) {
      const val = interpolateTemplate(tplVal, fullVars);
      if (val !== '') {
        urlObj.searchParams.set(key, val);
      }
    }
  }

  const method = (reqConfig.method ?? 'GET').toUpperCase();
  const headers = new Headers();

  for (const [k, v] of Object.entries(source.headers ?? {})) {
    headers.set(k, interpolateTemplate(v, fullVars));
  }
  for (const [k, v] of Object.entries(reqConfig.headers ?? {})) {
    headers.set(k, interpolateTemplate(v, fullVars));
  }

  let body: string | undefined;
  if (method === 'POST' && reqConfig.formBody) {
    const params = new URLSearchParams();
    for (const [k, tplVal] of Object.entries(reqConfig.formBody)) {
      params.append(k, interpolateTemplate(tplVal, fullVars));
    }
    body = params.toString();
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    }
  } else if (method === 'POST' && reqConfig.jsonBody) {
    body = JSON.stringify(interpolateUnknown(reqConfig.jsonBody, fullVars));
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const serializedHeaders = Object.entries(serializeHeadersInit(headers))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('\n');
  const url = urlObj.toString();
  const responseType = reqConfig.responseType ?? 'html';
  const cacheKey = `${method} ${url}\n${serializedHeaders}\n${body ?? ''}`;

  return {
    url,
    init: { method, headers, body },
    responseType,
    cacheKey,
  };
}

export function isSameSourceRequest(
  source: SourceConfig,
  reqA: RequestConfig,
  reqB: RequestConfig,
  vars: Partial<TemplateVariables> = {},
): boolean {
  try {
    return (
      prepareSourceRequest(source, reqA, vars).cacheKey ===
      prepareSourceRequest(source, reqB, vars).cacheKey
    );
  } catch {
    return false;
  }
}

export async function fetchSourceResponse(
  source: SourceConfig,
  reqConfig: RequestConfig,
  vars: Partial<TemplateVariables> = {},
  timeoutMs = 15_000,
): Promise<FetchedResponse> {
  const fullVars: TemplateVariables = {
    baseUrl: source.baseUrl,
    vars: source.vars,
    ...vars,
  };
  const { url, init, responseType } = prepareSourceRequest(source, reqConfig, vars);

  let { response, text } = await executeTimedFetch(url, init, source, timeoutMs);

  // Certains sites retournent HTTP 403 tant qu'un cookie de session initial n'a pas été déposé via warmupUrl.
  if (response.status === 403 && source.warmupUrl) {
    const resolvedWarmup = new URL(
      interpolateTemplate(source.warmupUrl, fullVars),
      ensureTrailingSlash(source.baseUrl),
    ).toString();
    if (resolvedWarmup !== url) {
      const warmupHeaders = new Headers();
      for (const [k, v] of Object.entries(source.headers ?? {})) {
        warmupHeaders.set(k, interpolateTemplate(v, fullVars));
      }
      await executeTimedFetch(
        resolvedWarmup,
        { method: 'GET', headers: warmupHeaders },
        source,
        timeoutMs,
      );
      ({ response, text } = await executeTimedFetch(url, init, source, timeoutMs));
    }
  }

  if (!response.ok) {
    throw new SourceHttpError({
      sourceId: source.id,
      url,
      status: response.status,
      statusText: response.statusText,
    });
  }

  let json: unknown = undefined;
  if (responseType === 'json' || responseType === 'json-html') {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Réponse JSON invalide reçue de ${source.name}.`);
    }
  }

  return {
    text,
    json,
    finalUrl: response.url || url,
    status: response.status,
  };
}

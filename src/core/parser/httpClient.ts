import {
  clearAllSiteTabProxyHints,
  clearSiteTabProxied,
  isSiteTabProxied,
  markSiteTabProxied,
  notifyCloudflareDomainUnlocked,
  requestTabProxyFetch,
} from '@/src/core/extension/browserBridge';
import type {
  RequestConfig,
  ResponseType,
  ScriptJsonExtractionConfig,
  SourceConfig,
} from '@/src/core/types/source';

export class CloudflareChallengeError extends Error {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly url: string;
  readonly requestUrl?: string;
  readonly status: number;
  readonly reason?: 'no_tab' | 'tab_blocked';

  constructor(params: {
    sourceId: string;
    sourceName: string;
    url: string;
    requestUrl?: string;
    status: number;
    reason?: 'no_tab' | 'tab_blocked';
  }) {
    const suffix =
      params.reason === 'tab_blocked'
        ? ' (the open tab is also returning a Cloudflare challenge — reload it with F5)'
        : params.reason === 'no_tab'
          ? ' (no open tab found for this domain)'
          : '';
    super(
      `Cloudflare / anti-bot protection detected on ${params.sourceName} (HTTP ${params.status})${suffix}.`,
    );
    this.name = 'CloudflareChallengeError';
    this.sourceId = params.sourceId;
    this.sourceName = params.sourceName;
    this.url = params.url;
    this.requestUrl = params.requestUrl;
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
    super(params.message ?? `HTTP error ${params.status} (${params.statusText}) at ${params.url}`);
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

function extractParentSlug(urlOrPath: string): string {
  if (!urlOrPath) return '';
  try {
    const parsed = new URL(urlOrPath, 'https://placeholder.invalid');
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? (parts.at(-2) ?? '') : (parts[0] ?? '');
  } catch {
    const clean = urlOrPath.split(/[?#]/)[0] ?? '';
    const parts = clean.split('/').filter(Boolean);
    return parts.length >= 2 ? (parts.at(-2) ?? '') : (parts[0] ?? '');
  }
}

function extractQueryId(urlOrPath: string): string {
  if (!urlOrPath) return '';
  try {
    const parsed = new URL(urlOrPath, 'https://placeholder.invalid');
    return parsed.searchParams.get('id') ?? extractLastSlug(urlOrPath);
  } catch {
    const match = /[?&]id=([^&#]+)/.exec(urlOrPath);
    return match?.[1] ?? extractLastSlug(urlOrPath);
  }
}

function extractPath(urlOrPath: string): string {
  if (!urlOrPath) return '';
  try {
    return new URL(urlOrPath, 'https://placeholder.invalid').pathname;
  } catch {
    return (urlOrPath.split(/[?#]/)[0] ?? '').replace(/^https?:\/\/[^/]+/, '');
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
    mangaPath: extractPath(mangaUrl),
    mangaSlug: extractLastSlug(mangaUrl),
    mangaParentSlug: extractParentSlug(mangaUrl),
    mangaQueryId: extractQueryId(mangaUrl),
    chapterUrl,
    chapterUrlSlash: chapterUrl ? ensureTrailingSlash(chapterUrl) : '',
    chapterPath: extractPath(chapterUrl),
    chapterSlug: extractLastSlug(chapterUrl),
    chapterParentSlug: extractParentSlug(chapterUrl),
    chapterQueryId: extractQueryId(chapterUrl),
  };

  const extractSegments = (rawUrl: string) =>
    extractPath(rawUrl)
      .split('/')
      .filter(Boolean);
  const mangaSegs = extractSegments(mangaUrl);
  const chapterSegs = extractSegments(chapterUrl);

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key.startsWith('vars.')) {
      const varName = key.slice(5);
      return variables.vars?.[varName] ?? '';
    }
    const segMatch = /^(manga|chapter)Path\[(\d+)\]$/.exec(key);
    if (segMatch) {
      const idx = Number.parseInt(segMatch[2] ?? '0', 10);
      return (segMatch[1] === 'manga' ? mangaSegs[idx] : chapterSegs[idx]) ?? '';
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
      message: `Unable to reach ${source.name} via the open tab (${res.error}).`,
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
  requestUrl?: string,
): never {
  throw new CloudflareChallengeError({
    sourceId: source.id,
    sourceName: source.name,
    url: source.baseUrl,
    requestUrl,
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
        throwCloudflareError(source, proxied.response.status, 'tab_blocked', url);
      }
      markSiteTabProxied(url);
      notifyCloudflareDomainUnlocked(url);
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
        message: `Request timed out (${timeoutMs / 1000}s) while connecting to ${source.name}.`,
      });
    }
    throw new SourceHttpError({
      sourceId: source.id,
      url,
      status: 0,
      statusText: 'Network Error',
      message: `Unable to reach ${source.name} (${err instanceof Error ? err.message : 'Network error'}).`,
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
      notifyCloudflareDomainUnlocked(url);
      return proxied;
    }
    throwCloudflareError(
      source,
      proxied?.response.status ?? response.status,
      proxied ? 'tab_blocked' : 'no_tab',
      url,
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
  responseType: ResponseType;
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
  const scriptKey = JSON.stringify(reqConfig.scriptJson ?? null);
  const cacheKey = `${method} ${url}\n${serializedHeaders}\n${body ?? ''}\n${scriptKey}`;

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

export function extractJsonFromHtmlScript(
  html: string,
  cfg: ScriptJsonExtractionConfig,
  sourceName: string,
): unknown {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = cfg.selector
    ? Array.from(doc.querySelectorAll(cfg.selector))
    : Array.from(doc.querySelectorAll('script'));
  const re = cfg.regex ? new RegExp(cfg.regex) : null;

  for (const scriptEl of scripts) {
    const rawScript = (scriptEl.textContent ?? '').trim();
    if (!rawScript) continue;

    if (re) {
      const match = re.exec(rawScript);
      if (!match) continue;
      const candidate = (match[1] ?? match[0] ?? '').trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }

    try {
      return JSON.parse(rawScript);
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to extract embedded script JSON from ${sourceName}.`);
}

function collectMatchingObjects(
  node: unknown,
  requiredKeys: string[],
  out: unknown[],
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectMatchingObjects(item, requiredKeys, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (
    requiredKeys.length > 0 &&
    requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(rec, k))
  ) {
    out.push(rec);
  }
  for (const val of Object.values(rec)) {
    collectMatchingObjects(val, requiredKeys, out);
  }
}

function unescapeNextJsChunk(rawEscaped: string): string {
  try {
    return JSON.parse(`"${rawEscaped}"`) as string;
  } catch {
    return rawEscaped
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }
}

function scanJsonValuesInText(text: string): unknown[] {
  const results: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') {
      i += 1;
      continue;
    }
    const open = ch;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          inStr = false;
        }
        continue;
      }
      if (c === '"') {
        inStr = true;
      } else if (c === open) {
        depth += 1;
      } else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end > i) {
      const slice = text.slice(i, end);
      try {
        results.push(JSON.parse(slice));
        i = end;
        continue;
      } catch {
        // Not valid standalone JSON, advance past opening brace
      }
    }
    i += 1;
  }
  return results;
}

/**
 * Extrait les objets JSON embarqués dans les chunks Next.js App Router (`self.__next_f.push([1,"..."])`).
 */
export function extractNextJsFlightObjects(
  html: string,
  requiredKeys: string[] = [],
): unknown[] {
  const pushRe = /self\.__next_f\.push\(\[\s*1\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g;
  const decodedParts: string[] = [];
  for (const match of html.matchAll(pushRe)) {
    if (match[1]) {
      decodedParts.push(unescapeNextJsChunk(match[1]));
    }
  }
  const combined = decodedParts.length > 0 ? decodedParts.join('\n') : html;
  const parsedRoots = scanJsonValuesInText(combined);
  if (requiredKeys.length === 0) {
    return parsedRoots;
  }
  const matched: unknown[] = [];
  for (const root of parsedRoots) {
    collectMatchingObjects(root, requiredKeys, matched);
  }
  return matched;
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
  if (responseType === 'nextjs-flight') {
    json = extractNextJsFlightObjects(text, reqConfig.flightMatchKeys ?? []);
  } else if (responseType === 'json' || responseType === 'json-html') {
    if (reqConfig.scriptJson) {
      json = extractJsonFromHtmlScript(text, reqConfig.scriptJson, source.name);
    } else {
      try {
        json = JSON.parse(text);
      } catch {
        // Certains points de terminaison WP/HTML (ex: ScanReader admin-ajax) renvoient parfois du HTML brut au lieu de JSON
        if (responseType === 'json') {
          throw new Error(`Invalid JSON response received from ${source.name}.`);
        }
      }
    }
  }

  return {
    text,
    json,
    finalUrl: response.url || url,
    status: response.status,
  };
}

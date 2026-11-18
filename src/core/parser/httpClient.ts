import type { RequestConfig, SourceConfig } from '@/src/core/types/source';

export class CloudflareChallengeError extends Error {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly url: string;
  readonly status: number;

  constructor(params: { sourceId: string; sourceName: string; url: string; status: number }) {
    super(
      `Protection Cloudflare / anti-bot détectée sur ${params.sourceName} (HTTP ${params.status}).`,
    );
    this.name = 'CloudflareChallengeError';
    this.sourceId = params.sourceId;
    this.sourceName = params.sourceName;
    this.url = params.url;
    this.status = params.status;
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
    chapterUrl,
    chapterUrlSlash: chapterUrl ? ensureTrailingSlash(chapterUrl) : '',
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

export function isCloudflareResponse(status: number, headers: Headers, bodyText: string): boolean {
  if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
    return true;
  }
  if (status === 403 || status === 503 || status === 429) {
    const lower = bodyText.toLowerCase();
    if (
      lower.includes('<title>just a moment...</title>') ||
      lower.includes('challenges.cloudflare.com') ||
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

  const method = reqConfig.method ?? 'GET';
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(urlObj.toString(), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SourceHttpError({
        sourceId: source.id,
        url: urlObj.toString(),
        status: 408,
        statusText: 'Timeout',
        message: `Délai dépassé (${timeoutMs / 1000}s) lors de la connexion à ${source.name}.`,
      });
    }
    throw new SourceHttpError({
      sourceId: source.id,
      url: urlObj.toString(),
      status: 0,
      statusText: 'Network Error',
      message: `Impossible de joindre ${source.name} (${err instanceof Error ? err.message : 'Erreur réseau'}).`,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (isCloudflareResponse(response.status, response.headers, text)) {
    throw new CloudflareChallengeError({
      sourceId: source.id,
      sourceName: source.name,
      url: source.baseUrl,
      status: response.status,
    });
  }

  if (!response.ok) {
    throw new SourceHttpError({
      sourceId: source.id,
      url: urlObj.toString(),
      status: response.status,
      statusText: response.statusText,
    });
  }

  let json: unknown = undefined;
  const responseType = reqConfig.responseType ?? 'html';
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
    finalUrl: response.url || urlObj.toString(),
    status: response.status,
  };
}

import {
  getSiteRootDomain,
  isExtensionContext,
  sendBackgroundMessage,
} from '@/src/core/extension/browserBridge';
import { extractChapterNumber } from '@/src/core/parser/chapterNumber';
import { parseFlexibleDate } from '@/src/core/parser/dateParser';
import {
  CloudflareChallengeError,
  extractJsonFromHtmlScript,
  type FetchedResponse,
  fetchSourceResponse,
  interpolateTemplate,
  isCloudflareResponse,
  isSameSourceRequest,
} from '@/src/core/parser/httpClient';
import type {
  CatalogueEndpointConfig,
  FieldExtractor,
  MangaPublicationStatus,
  NumberedPagesConfig,
  ParsedCatalogueItem,
  ParsedCataloguePage,
  ParsedChapterItem,
  ParsedMangaDetails,
  ParsedPageItem,
  ResponseType,
  SourceConfig,
} from '@/src/core/types/source';

export function getByDotPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  const parts = path.split('.').filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number.parseInt(part, 10);
      if (Number.isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function readOwnText(element: Element): string {
  let result = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      result += node.nodeValue ?? '';
    }
  }
  return result;
}

function readSingleAttribute(element: Element, attrName: string): string {
  if (attrName === 'text') return element.textContent ?? '';
  if (attrName === 'ownText') return readOwnText(element);
  if (attrName === 'html') return element.innerHTML ?? '';
  return element.getAttribute(attrName) ?? '';
}

function splitSelectorAlternatives(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && selector[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findBalancedParenEnd(str: string, openIdx: number): number {
  let depth = 0;
  let quote = '';
  for (let i = openIdx; i < str.length; i += 1) {
    const ch = str[i]!;
    if (quote) {
      if (ch === quote && str[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function querySingleCompatSelector(scope: ParentNode, part: string): Element[] {
  if (!part.includes(':contains')) {
    try {
      return Array.from(scope.querySelectorAll(part));
    } catch {
      return [];
    }
  }

  // Handle outer `:has(...:contains...)` patterns
  const hasIdx = part.indexOf(':has(');
  if (hasIdx !== -1) {
    const openIdx = hasIdx + 4;
    const closeIdx = findBalancedParenEnd(part, openIdx);
    if (closeIdx !== -1) {
      const inner = part.slice(openIdx + 1, closeIdx);
      if (inner.includes(':contains')) {
        const prefix = part.slice(0, hasIdx).trim() || '*';
        const suffix = part.slice(closeIdx + 1).trim();
        const hosts = querySingleCompatSelector(scope, prefix).filter(
          (el) => querySelectorAllCompat(el, inner).length > 0,
        );
        if (!suffix) return hosts;
        const out: Element[] = [];
        for (const host of hosts) {
          if (suffix.startsWith('+')) {
            const restSel = suffix.slice(1).trim();
            if (host.nextElementSibling && (!restSel || host.nextElementSibling.matches(restSel))) {
              out.push(host.nextElementSibling);
            }
          } else {
            const normalizedSuffix = suffix.startsWith('>') ? `:scope ${suffix}` : suffix;
            out.push(...querySelectorAllCompat(host, normalizedSuffix));
          }
        }
        return out;
      }
    }
  }

  // Handle `:contains(...)` and `:containsOwn(...)`
  const match = /^([\s\S]*?):(containsOwn|contains)\((['"]?)(.*?)\3\)([\s\S]*)$/.exec(part);
  if (!match) {
    try {
      return Array.from(scope.querySelectorAll(part));
    } catch {
      return [];
    }
  }

  const rawPrefix = (match[1] ?? '').trim();
  const mode = match[2];
  const needle = (match[4] ?? '').trim().toLowerCase();
  const rest = (match[5] ?? '').trim();
  const baseSelector = !rawPrefix || rawPrefix.endsWith('>') || rawPrefix.endsWith('+') || rawPrefix.endsWith('~')
    ? `${rawPrefix} *`.trim()
    : rawPrefix;

  let baseNodes: Element[] = [];
  try {
    baseNodes = Array.from(scope.querySelectorAll(baseSelector));
  } catch {
    baseNodes = [];
  }

  const matched = baseNodes.filter((el) => {
    const text = (mode === 'containsOwn' ? readOwnText(el) : (el.textContent ?? '')).toLowerCase();
    return text.includes(needle);
  });

  if (!rest) return matched;

  const out: Element[] = [];
  for (const el of matched) {
    if (rest.startsWith('+')) {
      const sibSel = rest.slice(1).trim();
      const nextEl = el.nextElementSibling;
      if (nextEl && (!sibSel || querySelectorAllCompat(el.parentElement ?? scope, sibSel).includes(nextEl))) {
        out.push(nextEl);
      }
    } else {
      const normalizedRest = rest.startsWith('>') ? `:scope ${rest}` : rest;
      out.push(...querySelectorAllCompat(el, normalizedRest));
    }
  }
  return out;
}

function querySelectorAllCompat(scope: ParentNode, selector: string): Element[] {
  const clean = selector.trim();
  if (!clean) return [];
  if (!clean.includes(':contains')) {
    try {
      return Array.from(scope.querySelectorAll(clean));
    } catch {
      return [];
    }
  }
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const alt of splitSelectorAlternatives(clean)) {
    for (const el of querySingleCompatSelector(scope, alt)) {
      if (!seen.has(el)) {
        seen.add(el);
        result.push(el);
      }
    }
  }
  return result;
}

function findMatchingElements(scope: ParentNode, extractor: FieldExtractor): Element[] {
  if (!extractor.selector) {
    return scope instanceof Element ? [scope] : [];
  }

  const selectors = Array.isArray(extractor.selector)
    ? extractor.selector
    : [extractor.selector];

  let nodes: Element[] = [];
  for (const sel of selectors) {
    const found =
      sel === 'self'
        ? scope instanceof Element
          ? [scope]
          : []
        : querySelectorAllCompat(scope, sel);
    if (found.length > 0) {
      nodes = found;
      break;
    }
  }

  if (extractor.labelMatch && extractor.labelMatch.length > 0) {
    const targets = extractor.labelMatch.map((l) => l.trim().toLowerCase());
    const matched: Element[] = [];
    for (const node of nodes) {
      const labelText = (node.textContent ?? '').replace(/[:\s]+$/g, '').trim().toLowerCase();
      if (targets.some((t) => labelText === t || labelText.startsWith(t))) {
        if (node.nextElementSibling) {
          matched.push(node.nextElementSibling);
        }
      }
    }
    return matched;
  }

  return nodes;
}

function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes('&')) return value;
  const doc = parseHtmlDocument('');
  const textarea = doc.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function applyPostProcessing(
  rawValue: string,
  extractor: FieldExtractor,
  baseUrl: string,
  pageUrl?: string,
  vars?: Record<string, string>,
  mangaUrl?: string,
): string {
  let value = extractor.trim === false ? rawValue : rawValue.trim();

  if (extractor.decodeHtmlEntities) {
    value = decodeHtmlEntities(value);
  }

  if (extractor.base64Reverse && value) {
    try {
      const cleaned = value.replace(/\s+/g, '');
      const decoded = atob(cleaned);
      value = decoded.split('').reverse().join('');
    } catch {
      // Ignore malformed base64 and fall back cleanly
    }
  }

  if (extractor.regex) {
    const re = new RegExp(extractor.regex);
    const match = re.exec(value);
    if (match) {
      value = match[1] ?? match[0] ?? '';
    }
  }

  if (extractor.replace) {
    for (const rule of extractor.replace) {
      const re = new RegExp(rule.pattern, rule.flags ?? 'g');
      value = value.replace(re, rule.replacement);
    }
  }

  if (extractor.trim !== false) {
    value = value.trim();
  }

  if (value && extractor.prefix) {
    value = `${interpolateTemplate(extractor.prefix, { baseUrl, mangaUrl, vars })}${value}`;
  }

  if (value && extractor.suffix) {
    value = `${value}${interpolateTemplate(extractor.suffix, { baseUrl, mangaUrl, vars })}`;
  }

  if (extractor.absoluteUrl && value) {
    try {
      const originBase = pageUrl || (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      value = new URL(value, originBase).toString();
    } catch {
      // Conserve la valeur brute si l'URL est malformée
    }
  }

  return value;
}

export function extractDomField(
  scope: ParentNode,
  extractor: FieldExtractor | undefined,
  baseUrl: string,
  pageUrl?: string,
): string {
  if (!extractor) return '';

  const elements = findMatchingElements(scope, extractor);
  if (elements.length === 0) return '';

  const attrList = Array.isArray(extractor.attr)
    ? extractor.attr
    : [extractor.attr ?? 'text'];

  const readFromEl = (el: Element): string => {
    for (const attrName of attrList) {
      const candidate = readSingleAttribute(el, attrName);
      const cleaned = extractor.trim === false ? candidate : candidate.trim();
      if (cleaned) return cleaned;
    }
    return '';
  };

  let raw = '';
  if (extractor.joinAll !== undefined) {
    const parts = elements.map(readFromEl).filter(Boolean);
    raw = parts.join(extractor.joinAll);
  } else {
    for (const el of elements) {
      const candidate = readFromEl(el);
      if (candidate) {
        raw = candidate;
        break;
      }
    }
  }

  return applyPostProcessing(raw, extractor, baseUrl, pageUrl);
}

function renderJsonTemplate(
  template: string,
  item: unknown,
  baseUrl: string,
  mangaUrl?: string,
  vars?: Record<string, string>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const val = getByDotPath(item, key);
    if (val !== null && val !== undefined) {
      return Array.isArray(val) ? val.map(stringifyJsonElement).join(', ') : String(val);
    }
    return interpolateTemplate(`{{${key}}}`, { baseUrl, mangaUrl, vars });
  });
}

function stringifyJsonElement(el: unknown): string {
  if (el === null || el === undefined) return '';
  if (typeof el === 'object') {
    const rec = el as Record<string, unknown>;
    const named = rec.name ?? rec.title ?? rec.tag ?? rec.label;
    if (named !== undefined && named !== null) return String(named);
  }
  return String(el);
}

export function extractJsonField(
  item: unknown,
  extractor: FieldExtractor | undefined,
  baseUrl: string,
  vars?: Record<string, string>,
  mangaUrl?: string,
): string {
  if (!extractor) return '';

  let raw = '';
  if (extractor.jsonTemplate) {
    raw = renderJsonTemplate(extractor.jsonTemplate, item, baseUrl, mangaUrl, vars);
  } else {
    const rawPaths =
      extractor.jsonPath ??
      (typeof extractor.attr === 'string' && extractor.attr !== 'text'
        ? extractor.attr
        : undefined);
    const paths = Array.isArray(rawPaths) ? rawPaths : [rawPaths];
    for (const path of paths) {
      const val = getByDotPath(item, path);
      if (val === null || val === undefined) continue;
      const candidate = Array.isArray(val)
        ? val.map(stringifyJsonElement).filter(Boolean).join(extractor.joinAll ?? ', ')
        : stringifyJsonElement(val);
      if (candidate.trim() !== '' || paths.length === 1) {
        raw = candidate;
        break;
      }
    }
  }

  return applyPostProcessing(raw, extractor, baseUrl, undefined, vars, mangaUrl);
}

function getHtmlDocumentFromResponse(
  res: FetchedResponse,
  responseType: ResponseType | undefined,
  jsonHtmlPath?: string,
): Document {
  if (responseType === 'json-html' && res.json !== undefined) {
    const htmlFragment = getByDotPath(res.json, jsonHtmlPath);
    return parseHtmlDocument(typeof htmlFragment === 'string' ? htmlFragment : '');
  }
  return parseHtmlDocument(res.text);
}

function mapPublicationStatus(
  rawStatus: string,
  statusMap?: Record<string, MangaPublicationStatus>,
): MangaPublicationStatus {
  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized) return 'unknown';

  if (statusMap) {
    for (const [key, mapped] of Object.entries(statusMap)) {
      if (normalized.includes(key.toLowerCase())) {
        return mapped;
      }
    }
  }

  if (normalized.includes('en cours') || normalized.includes('ongoing')) return 'ongoing';
  if (normalized.includes('termin') || normalized.includes('complet') || normalized.includes('end')) {
    return 'completed';
  }
  if (normalized.includes('pause') || normalized.includes('hiatus')) return 'hiatus';
  if (normalized.includes('abandon') || normalized.includes('annul') || normalized.includes('cancel')) {
    return 'cancelled';
  }
  return 'unknown';
}

const SCRIPT_TOKENS_TTL_MS = 3 * 60 * 60 * 1000;

function decodeJsHexEscapes(input: string): string {
  return input.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function stripUrlSuffixes(rawUrl: string, suffixes: string[]): string {
  let clean = rawUrl.trim();
  let changed = true;
  while (changed) {
    changed = false;
    if (clean.endsWith('/')) {
      clean = clean.slice(0, -1);
      changed = true;
    }
    for (const suffix of suffixes) {
      if (suffix && clean.endsWith(suffix)) {
        clean = clean.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return clean;
}

function computeJsonHasNextPage(
  endpoint: CatalogueEndpointConfig,
  json: unknown,
  itemsCount: number,
  page: number,
): boolean {
  if (endpoint.hasNextPageJsonPath) {
    return Boolean(getByDotPath(json, endpoint.hasNextPageJsonPath));
  }
  if (endpoint.hasNextPageCalc) {
    const total = Number(getByDotPath(json, endpoint.hasNextPageCalc.totalPath));
    const limitRaw = endpoint.hasNextPageCalc.limitPath
      ? Number(getByDotPath(json, endpoint.hasNextPageCalc.limitPath))
      : Number.NaN;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? limitRaw
        : (endpoint.hasNextPageCalc.pageSize ?? endpoint.pageSize ?? itemsCount);
    const pageRaw = endpoint.hasNextPageCalc.pagePath
      ? Number(getByDotPath(json, endpoint.hasNextPageCalc.pagePath))
      : page;
    const currentPage = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : page;
    return Number.isFinite(total) && limit > 0 ? currentPage * limit < total : false;
  }
  return Boolean(endpoint.pageSize && itemsCount >= endpoint.pageSize);
}

export class UniversalParserEngine {
  private readonly scriptTokensCache = new Map<string, { expiresAt: number; tokens: string[] }>();

  async getCatalogue(
    source: SourceConfig,
    endpoint: CatalogueEndpointConfig,
    vars: { page?: number; query?: string } = {},
  ): Promise<ParsedCataloguePage> {
    const page = vars.page ?? 1;
    const res = await fetchSourceResponse(source, endpoint.request, {
      page,
      query: vars.query,
    });

    const responseType = endpoint.request.responseType ?? 'html';
    const items: ParsedCatalogueItem[] = [];

    if (responseType === 'json' || responseType === 'nextjs-flight') {
      const jsonRoot =
        responseType === 'nextjs-flight' && Array.isArray(res.json) && endpoint.itemsPath
          ? res.json[0]
          : res.json;
      const rawItems = getByDotPath(jsonRoot, endpoint.itemsPath);
      const list = Array.isArray(rawItems) ? rawItems : [];
      for (const entry of list) {
        const title = extractJsonField(entry, endpoint.fields.title, source.baseUrl, source.vars);
        const url = extractJsonField(entry, endpoint.fields.url, source.baseUrl, source.vars);
        if (!title || !url) continue;
        const coverUrl =
          extractJsonField(entry, endpoint.fields.cover, source.baseUrl, source.vars) || undefined;
        const latestChapter =
          extractJsonField(entry, endpoint.fields.latestChapter, source.baseUrl, source.vars) ||
          undefined;
        items.push({ sourceId: source.id, title, url, coverUrl, latestChapter });
      }
      return {
        items,
        hasNextPage: computeJsonHasNextPage(endpoint, jsonRoot, items.length, page),
      };
    }

    const doc = getHtmlDocumentFromResponse(res, responseType, endpoint.request.jsonHtmlPath);
    const nodes = endpoint.itemSelector ? querySelectorAllCompat(doc, endpoint.itemSelector) : [];

    for (const el of nodes) {
      const title = extractDomField(el, endpoint.fields.title, source.baseUrl, res.finalUrl);
      const url = extractDomField(el, endpoint.fields.url, source.baseUrl, res.finalUrl);
      if (!title || !url) continue;
      const coverUrl =
        extractDomField(el, endpoint.fields.cover, source.baseUrl, res.finalUrl) || undefined;
      const latestChapter =
        extractDomField(el, endpoint.fields.latestChapter, source.baseUrl, res.finalUrl) ||
        undefined;
      items.push({ sourceId: source.id, title, url, coverUrl, latestChapter });
    }

    let hasNextPage = false;
    if (responseType === 'json-html' && endpoint.hasNextPageJsonPath) {
      hasNextPage = Boolean(getByDotPath(res.json, endpoint.hasNextPageJsonPath));
    } else if (endpoint.hasNextPageSelector) {
      hasNextPage = querySelectorAllCompat(doc, endpoint.hasNextPageSelector).length > 0;
    } else if (endpoint.pageSize) {
      hasNextPage = items.length >= endpoint.pageSize;
    }

    return { items, hasNextPage };
  }

  getPopular(source: SourceConfig, page = 1): Promise<ParsedCataloguePage> {
    const endpoint = source.popular ?? source.latest;
    if (!endpoint) {
      throw new Error(`Source "${source.name}" does not define a popular catalogue.`);
    }
    return this.getCatalogue(source, endpoint, { page });
  }

  getLatest(source: SourceConfig, page = 1): Promise<ParsedCataloguePage> {
    const endpoint = source.latest ?? source.popular;
    if (!endpoint) {
      throw new Error(`Source "${source.name}" does not define a latest releases catalogue.`);
    }
    return this.getCatalogue(source, endpoint, { page });
  }

  search(source: SourceConfig, query: string, page = 1): Promise<ParsedCataloguePage> {
    const endpoint = source.search;
    if (!endpoint) {
      throw new Error(`Source "${source.name}" does not support search.`);
    }
    return this.getCatalogue(source, endpoint, { page, query });
  }

  async getMangaDetails(source: SourceConfig, mangaUrl: string): Promise<ParsedMangaDetails> {
    const cfg = source.mangaDetails;
    const res = await fetchSourceResponse(source, cfg.request, { mangaUrl });
    const responseType = cfg.request.responseType ?? 'html';

    if (responseType === 'json' || responseType === 'nextjs-flight') {
      const jsonRoot =
        responseType === 'nextjs-flight' && Array.isArray(res.json)
          ? res.json[0]
          : res.json;
      const title = extractJsonField(jsonRoot, cfg.fields.title, source.baseUrl, source.vars);
      const rawStatus = extractJsonField(jsonRoot, cfg.fields.status, source.baseUrl, source.vars);
      const genresRaw = extractJsonField(jsonRoot, cfg.fields.genres, source.baseUrl, source.vars);
      const altRaw = extractJsonField(jsonRoot, cfg.fields.altTitles, source.baseUrl, source.vars);
      return {
        title: title || 'Untitled',
        url: mangaUrl,
        coverUrl:
          extractJsonField(jsonRoot, cfg.fields.cover, source.baseUrl, source.vars) || undefined,
        author:
          extractJsonField(jsonRoot, cfg.fields.author, source.baseUrl, source.vars) || undefined,
        artist:
          extractJsonField(jsonRoot, cfg.fields.artist, source.baseUrl, source.vars) || undefined,
        description:
          extractJsonField(jsonRoot, cfg.fields.description, source.baseUrl, source.vars) ||
          undefined,
        status: mapPublicationStatus(rawStatus, cfg.statusMap),
        genres: genresRaw
          ? genresRaw
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean)
          : [],
        altTitles: altRaw
          ? altRaw
              .split(/[,;/]/)
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        rawHtml: res.text,
        rawJson: res.json,
      };
    }

    const doc = getHtmlDocumentFromResponse(res, responseType, cfg.request.jsonHtmlPath);
    const title = extractDomField(doc, cfg.fields.title, source.baseUrl, res.finalUrl);
    const rawStatus = extractDomField(doc, cfg.fields.status, source.baseUrl, res.finalUrl);
    const genresRaw = extractDomField(doc, cfg.fields.genres, source.baseUrl, res.finalUrl);
    const altRaw = extractDomField(doc, cfg.fields.altTitles, source.baseUrl, res.finalUrl);

    return {
      title: title || 'Untitled',
      url: res.finalUrl || mangaUrl,
      coverUrl:
        extractDomField(doc, cfg.fields.cover, source.baseUrl, res.finalUrl) || undefined,
      author:
        extractDomField(doc, cfg.fields.author, source.baseUrl, res.finalUrl) || undefined,
      artist:
        extractDomField(doc, cfg.fields.artist, source.baseUrl, res.finalUrl) || undefined,
      description:
        extractDomField(doc, cfg.fields.description, source.baseUrl, res.finalUrl) || undefined,
      status: mapPublicationStatus(rawStatus, cfg.statusMap),
      genres: genresRaw
        ? Array.from(
            new Set(
              genresRaw
                .split(',')
                .map((g) => g.trim())
                .filter(Boolean),
            ),
          )
        : [],
      altTitles: altRaw
        ? altRaw
            .split(/[,;/]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      rawHtml: res.text,
      rawJson: res.json,
    };
  }

  async getChapters(
    source: SourceConfig,
    mangaUrl: string,
    cachedDetailsHtml?: string,
    cachedDetailsJson?: unknown,
  ): Promise<ParsedChapterItem[]> {
    const cfg = source.chapters;
    let items: ParsedChapterItem[] = [];
    let detailsHtml = cachedDetailsHtml;

    if (cfg.request) {
      const cfgResponseType = cfg.request.responseType ?? 'html';
      const hasCachedPayload =
        cfgResponseType === 'html'
          ? detailsHtml !== undefined
          : cachedDetailsJson !== undefined;
      const canReuseDetailsResponse =
        hasCachedPayload &&
        !cfg.extractVarsFromDetails &&
        isSameSourceRequest(source, cfg.request, source.mangaDetails.request, { mangaUrl });
      try {
        let effectiveSource = source;
        if (cfg.extractVarsFromDetails && Object.keys(cfg.extractVarsFromDetails).length > 0) {
          if (!detailsHtml) {
            detailsHtml = (
              await fetchSourceResponse(source, source.mangaDetails.request, { mangaUrl })
            ).text;
          }
          const detailsDoc = parseHtmlDocument(detailsHtml);
          const extractedVars: Record<string, string> = {};
          for (const [varKey, extractor] of Object.entries(cfg.extractVarsFromDetails)) {
            extractedVars[varKey] = extractDomField(detailsDoc, extractor, source.baseUrl, mangaUrl);
          }
          effectiveSource = {
            ...source,
            vars: {
              ...(source.vars ?? {}),
              ...extractedVars,
            },
          };
        }

        const res: FetchedResponse = canReuseDetailsResponse
          ? {
              text: detailsHtml ?? '',
              json: cachedDetailsJson,
              finalUrl: mangaUrl,
              status: 200,
            }
          : await fetchSourceResponse(effectiveSource, cfg.request, { mangaUrl });
        items = this.extractChaptersFromResponse(effectiveSource, res, mangaUrl);
      } catch (err) {
        if (!cfg.fallbackInline || !detailsHtml) {
          throw err;
        }
      }
    }

    if (items.length === 0 && (cfg.fallbackInline || !cfg.request)) {
      const html =
        detailsHtml ??
        (await fetchSourceResponse(source, source.mangaDetails.request, { mangaUrl })).text;
      items = this.extractChaptersFromHtml(source, html, mangaUrl);
    }

    return cfg.reverseOrder ? [...items].reverse() : items;
  }

  private extractChaptersFromResponse(
    source: SourceConfig,
    res: FetchedResponse,
    mangaUrl: string,
  ): ParsedChapterItem[] {
    const cfg = source.chapters;
    const responseType = cfg.request?.responseType ?? 'html';

    if (responseType === 'json' || responseType === 'nextjs-flight') {
      const flightBase =
        responseType === 'nextjs-flight' && Array.isArray(res.json) && cfg.itemsPath
          ? res.json[0]
          : res.json;
      const rawList = getByDotPath(flightBase, cfg.itemsPath);
      let list: unknown[] = [];
      if (Array.isArray(rawList)) {
        list = rawList;
      } else if (
        cfg.objectEntriesKeyField &&
        rawList &&
        typeof rawList === 'object'
      ) {
        const keyField = cfg.objectEntriesKeyField;
        list = Object.entries(rawList as Record<string, unknown>).map(([k, val]) =>
          val && typeof val === 'object' && !Array.isArray(val)
            ? { ...(val as Record<string, unknown>), [keyField]: k }
            : { value: val, [keyField]: k },
        );
      }
      const chapters: ParsedChapterItem[] = [];
      const seenUrls = new Set<string>();
      for (const entry of list) {
        const title = extractJsonField(
          entry,
          cfg.fields.title,
          source.baseUrl,
          source.vars,
          mangaUrl,
        );
        const url = extractJsonField(
          entry,
          cfg.fields.url,
          source.baseUrl,
          source.vars,
          mangaUrl,
        );
        if (!title || !url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const rawNum = extractJsonField(
          entry,
          cfg.fields.chapterNumber,
          source.baseUrl,
          source.vars,
        );
        const rawDate = extractJsonField(entry, cfg.fields.date, source.baseUrl, source.vars);
        const parsedNum = rawNum ? Number.parseFloat(rawNum) : extractChapterNumber(title);
        chapters.push({
          title,
          url,
          chapterNumber: parsedNum !== null && Number.isFinite(parsedNum) ? parsedNum : null,
          publishedAt: parseFlexibleDate(rawDate),
        });
      }
      return chapters;
    }

    const doc = getHtmlDocumentFromResponse(res, responseType, cfg.request?.jsonHtmlPath);
    return this.extractChaptersFromDoc(source, doc, res.finalUrl || mangaUrl);
  }

  private extractChaptersFromHtml(
    source: SourceConfig,
    html: string,
    pageUrl: string,
  ): ParsedChapterItem[] {
    return this.extractChaptersFromDoc(source, parseHtmlDocument(html), pageUrl);
  }

  private extractChaptersFromDoc(
    source: SourceConfig,
    doc: Document,
    pageUrl: string,
  ): ParsedChapterItem[] {
    const cfg = source.chapters;
    const nodes = cfg.itemSelector ? querySelectorAllCompat(doc, cfg.itemSelector) : [];
    const chapters: ParsedChapterItem[] = [];

    for (const el of nodes) {
      const title = extractDomField(el, cfg.fields.title, source.baseUrl, pageUrl);
      const url = extractDomField(el, cfg.fields.url, source.baseUrl, pageUrl);
      if (!title || !url) continue;

      const rawNum = extractDomField(el, cfg.fields.chapterNumber, source.baseUrl, pageUrl);
      const rawDate = extractDomField(el, cfg.fields.date, source.baseUrl, pageUrl);
      const parsedNum = rawNum ? Number.parseFloat(rawNum) : extractChapterNumber(title);

      chapters.push({
        title,
        url,
        chapterNumber: parsedNum !== null && Number.isFinite(parsedNum) ? parsedNum : null,
        publishedAt: parseFlexibleDate(rawDate),
      });
    }
    return chapters;
  }

  async getChapterPages(source: SourceConfig, chapterUrl: string): Promise<ParsedPageItem[]> {
    const cfg = source.pages;
    const res = await fetchSourceResponse(source, cfg.request, { chapterUrl });
    const responseType = cfg.request.responseType ?? 'html';

    if (cfg.customPageDecoder === 'scanmanga-lel') {
      return this.decodeScanMangaLel(source, res, chapterUrl);
    }

    if (responseType === 'json' || responseType === 'nextjs-flight') {
      if (cfg.numberedPages) {
        return this.buildNumberedPages(source, res.json, chapterUrl, cfg.numberedPages);
      }

      if (cfg.findEntry) {
        const flightBase =
          responseType === 'nextjs-flight' && Array.isArray(res.json) && cfg.findEntry.itemsPath
            ? res.json[0]
            : res.json;
        const container = getByDotPath(flightBase, cfg.findEntry.itemsPath);
        const candidates = Array.isArray(container) ? container : [];
        const targetMatch = interpolateTemplate(cfg.findEntry.matchTemplate, {
          baseUrl: source.baseUrl,
          chapterUrl,
          vars: source.vars,
        });
        const matched = candidates.find((entry) => {
          const v = getByDotPath(entry, cfg.findEntry!.matchField);
          return v !== undefined && v !== null && String(v) === targetMatch;
        });
        if (!matched) return [];

        let rawImages: unknown[] = [];
        if (cfg.findEntry.parseJsonArrayField) {
          const encoded = getByDotPath(matched, cfg.findEntry.parseJsonArrayField);
          if (typeof encoded === 'string') {
            try {
              const parsed = JSON.parse(encoded);
              if (Array.isArray(parsed)) rawImages = parsed;
            } catch {
              rawImages = [];
            }
          }
        } else if (cfg.findEntry.itemsArrayField) {
          const arr = getByDotPath(matched, cfg.findEntry.itemsArrayField);
          if (Array.isArray(arr)) rawImages = arr;
        }

        const extractor = cfg.imageUrl ?? { jsonPath: '', absoluteUrl: true };
        const foundPages: ParsedPageItem[] = [];
        for (const imgEntry of rawImages) {
          const url = extractJsonField(imgEntry, extractor, source.baseUrl, source.vars);
          if (url) foundPages.push({ index: foundPages.length, imageUrl: url });
        }
        return foundPages;
      }

      if (!cfg.imageUrl) return [];
      const flightBase =
        responseType === 'nextjs-flight' && Array.isArray(res.json) && cfg.itemsPath
          ? res.json[0]
          : res.json;
      const rawList = getByDotPath(flightBase, cfg.itemsPath);
      const list = Array.isArray(rawList) ? rawList : [];
      const pages: ParsedPageItem[] = [];
      for (const entry of list) {
        const url = extractJsonField(entry, cfg.imageUrl, source.baseUrl, source.vars);
        if (url) {
          pages.push({ index: pages.length, imageUrl: url });
        }
      }
      return pages;
    }

    if (cfg.followPageLinks) {
      const initialDoc = getHtmlDocumentFromResponse(res, responseType, cfg.request.jsonHtmlPath);
      const optionNodes = querySelectorAllCompat(initialDoc, cfg.followPageLinks.itemSelector);
      const baseOrigin = res.finalUrl || chapterUrl;
      const pageUrls: string[] = [];
      const seen = new Set<string>();
      for (const node of optionNodes) {
        const rawHref = readSingleAttribute(node, cfg.followPageLinks.urlAttr ?? 'value').trim();
        if (!rawHref) continue;
        try {
          const abs = new URL(rawHref, baseOrigin).toString();
          if (!seen.has(abs)) {
            seen.add(abs);
            pageUrls.push(abs);
          }
        } catch {
          // Ignore invalid link
        }
      }

      const limitedUrls = pageUrls.slice(0, 200);
      const results = new Array<string | null>(limitedUrls.length).fill(null);
      let cursor = 0;
      const runBatch = async () => {
        while (cursor < limitedUrls.length) {
          const idx = cursor++;
          const targetUrl = limitedUrls[idx];
          if (!targetUrl) continue;
          try {
            const pageRes = await fetchSourceResponse(
              source,
              { method: 'GET', url: targetUrl, headers: cfg.request.headers },
              { chapterUrl: targetUrl },
            );
            const pDoc = parseHtmlDocument(pageRes.text);
            const imgUrl = extractDomField(
              pDoc,
              {
                selector: cfg.followPageLinks!.imageSelector,
                attr: cfg.followPageLinks!.imageAttr ?? ['data-src', 'src'],
                absoluteUrl: true,
              },
              source.baseUrl,
              pageRes.finalUrl || targetUrl,
            );
            if (imgUrl && !imgUrl.startsWith('data:image/gif')) {
              results[idx] = imgUrl;
            }
          } catch {
            // Continue remaining pages if one fails
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(6, limitedUrls.length || 1) }, () => runBatch()),
      );
      return results
        .filter((u): u is string => Boolean(u))
        .map((imageUrl, index) => ({ index, imageUrl }));
    }

    if (cfg.scriptJson) {
      try {
        const scriptData = extractJsonFromHtmlScript(res.text, cfg.scriptJson, source.name);
        const rawList = getByDotPath(scriptData, cfg.scriptJson.itemsPath ?? cfg.itemsPath);
        const list = Array.isArray(rawList) ? rawList : [];
        const scriptPages: ParsedPageItem[] = [];
        for (const entry of list) {
          if (typeof entry === 'string') {
            const url = cfg.imageUrl
              ? applyPostProcessing(entry, cfg.imageUrl, source.baseUrl, res.finalUrl || chapterUrl, source.vars)
              : entry.trim();
            if (url) scriptPages.push({ index: scriptPages.length, imageUrl: url });
          } else {
            const url = extractJsonField(entry, cfg.imageUrl, source.baseUrl, source.vars);
            if (url) scriptPages.push({ index: scriptPages.length, imageUrl: url });
          }
        }
        if (scriptPages.length > 0) {
          return scriptPages;
        }
      } catch {
        // Fallback to scriptArrayRegex or HTML DOM selectors below
      }
    }

    if (cfg.scriptArrayRegex) {
      const re = new RegExp(cfg.scriptArrayRegex, 'g');
      const arrayPages: ParsedPageItem[] = [];
      for (const match of res.text.matchAll(re)) {
        const rawToken = match[1] ?? match[0] ?? '';
        if (!rawToken) continue;
        const url = cfg.imageUrl
          ? applyPostProcessing(rawToken, cfg.imageUrl, source.baseUrl, res.finalUrl || chapterUrl, source.vars)
          : rawToken.trim();
        if (url && !url.startsWith('data:image/gif')) {
          arrayPages.push({ index: arrayPages.length, imageUrl: url });
        }
      }
      if (arrayPages.length > 0) {
        return arrayPages;
      }
    }

    const doc = getHtmlDocumentFromResponse(res, responseType, cfg.request.jsonHtmlPath);
    const nodes = cfg.itemSelector ? querySelectorAllCompat(doc, cfg.itemSelector) : [];
    const pages: ParsedPageItem[] = [];

    for (const el of nodes) {
      const imageUrl = extractDomField(
        el,
        cfg.imageUrl,
        source.baseUrl,
        res.finalUrl || chapterUrl,
      );
      if (imageUrl && !imageUrl.startsWith('data:image/gif')) {
        pages.push({ index: pages.length, imageUrl });
      }
    }

    return pages;
  }

  private async resolveScriptTokens(
    source: SourceConfig,
    chapterUrl: string,
    stripCfg: NonNullable<NumberedPagesConfig['stripTokensFromScript']>,
  ): Promise<string[]> {
    const minLength = stripCfg.minLength ?? 3;
    const scriptUrl = interpolateTemplate(stripCfg.url, {
      baseUrl: source.baseUrl,
      chapterUrl,
      vars: source.vars,
    });
    const cacheKey = `${scriptUrl}::${minLength}::${stripCfg.regexes.join('|')}`;
    const cached = this.scriptTokensCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tokens;
    }

    let tokens: string[];
    try {
      const scriptRes = await fetchSourceResponse(
        source,
        { method: 'GET', url: scriptUrl },
        { chapterUrl },
      );
      const extracted = new Set<string>();
      for (const rawRegex of stripCfg.regexes) {
        const re = new RegExp(rawRegex, 'g');
        for (const match of scriptRes.text.matchAll(re)) {
          const rawToken = match[1] ?? match[0] ?? '';
          const decoded = decodeJsHexEscapes(rawToken);
          if (decoded.length >= minLength) {
            extracted.add(decoded);
          }
        }
      }
      tokens = Array.from(extracted).sort((a, b) => b.length - a.length);
      if (tokens.length > 0) {
        this.scriptTokensCache.set(cacheKey, {
          expiresAt: Date.now() + SCRIPT_TOKENS_TTL_MS,
          tokens,
        });
      } else if (stripCfg.fallbackTokens?.length) {
        tokens = [...stripCfg.fallbackTokens].sort((a, b) => b.length - a.length);
      }
    } catch (err) {
      if (err instanceof CloudflareChallengeError || !stripCfg.fallbackTokens?.length) {
        throw err;
      }
      tokens = [...stripCfg.fallbackTokens].sort((a, b) => b.length - a.length);
    }

    return tokens;
  }

  private async buildNumberedPages(
    source: SourceConfig,
    resJson: unknown,
    chapterUrl: string,
    cfg: NumberedPagesConfig,
  ): Promise<ParsedPageItem[]> {
    const count = Number(getByDotPath(resJson, cfg.countJsonPath));
    const rawBaseUrl = getByDotPath(resJson, cfg.baseUrlJsonPath);
    if (
      !Number.isFinite(count) ||
      count <= 0 ||
      typeof rawBaseUrl !== 'string' ||
      !rawBaseUrl.trim()
    ) {
      return [];
    }

    const originBase = source.baseUrl.endsWith('/') ? source.baseUrl : `${source.baseUrl}/`;
    let resolvedBase: string;
    try {
      resolvedBase = new URL(rawBaseUrl.trim(), originBase).toString();
    } catch {
      resolvedBase = rawBaseUrl.trim();
    }

    let cleanBase = stripUrlSuffixes(resolvedBase, cfg.stripSuffixes ?? []);
    if (cfg.stripTokensFromScript) {
      const tokens = await this.resolveScriptTokens(source, chapterUrl, cfg.stripTokensFromScript);
      const lastSlash = cleanBase.lastIndexOf('/');
      if (lastSlash !== -1) {
        const prefixUrl = cleanBase.slice(0, lastSlash + 1);
        let lastSegment = cleanBase.slice(lastSlash + 1);
        const matchingTokens = tokens.filter((t) => lastSegment.includes(t));
        const activeTokens =
          matchingTokens.length > 0
            ? matchingTokens
            : [...(cfg.stripTokensFromScript.fallbackTokens ?? [])].sort(
                (a, b) => b.length - a.length,
              );
        for (const token of activeTokens) {
          if (token && lastSegment.includes(token)) {
            lastSegment = lastSegment.split(token).join('');
          }
        }
        cleanBase = stripUrlSuffixes(`${prefixUrl}${lastSegment}`, cfg.stripSuffixes ?? []);
      }
    }

    const padStart = cfg.padStart ?? 2;
    const ext = (cfg.extension ?? 'webp').replace(/^\./, '');
    const pages: ParsedPageItem[] = [];
    for (let i = 1; i <= count; i++) {
      const numStr = String(i).padStart(padStart, '0');
      pages.push({
        index: i - 1,
        imageUrl: `${cleanBase}/${numStr}.${ext}`,
      });
    }
    return pages;
  }

  private async decodeScanMangaLel(
    source: SourceConfig,
    res: FetchedResponse,
    chapterUrl: string,
  ): Promise<ParsedPageItem[]> {
    const targetChapterUrl = res.finalUrl || chapterUrl;
    const sml = /var\s+sml\s*=\s*['"]([^'"]+)['"]/.exec(res.text)?.[1];
    const sme = /var\s+sme\s*=\s*['"]([^'"]+)['"]/.exec(res.text)?.[1];
    const smi = /var\s+smi\s*=\s*['"]([^'"]+)['"]/.exec(res.text)?.[1];
    const chapterIdRaw = /_(\d+)\.html/.exec(targetChapterUrl)?.[1];
    if (!sml || !sme || !smi || !chapterIdRaw) {
      return [];
    }

    const chapterId = Number.parseInt(chapterIdRaw, 10);
    const parsedPageUrl = new URL(targetChapterUrl);
    const rootDomain = getSiteRootDomain(parsedPageUrl.hostname);
    const lelUrl = `https://bqj.${rootDomain}/lel/${chapterId}.json`;

    if (isExtensionContext()) {
      await sendBackgroundMessage({
        type: 'ENSURE_API_REFERER_ORIGIN',
        apiUrl: lelUrl,
        originUrl: parsedPageUrl.origin,
      });
    }

    const bodyPayload = JSON.stringify({
      a: sme,
      b: sml,
      c: 'eyJncHUiOiJBTkdMRSAoQU1ELCBBTUQgUmFkZW9uIFJYIDY2MDAgKHJhZGVvbnNpIG5hdmkyMyBMTFZNIDIwLjEuMiksIE9wZW5HTCA0LjYpIiwiY29ubmVjdGlvbiI6IklDIn0=',
      d: smi,
    });

    const apiResponse = await fetch(lelUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Token: 'yf',
        Source: targetChapterUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: bodyPayload,
    });

    const encodedData = await apiResponse.text();
    if (!apiResponse.ok) {
      if (isCloudflareResponse(apiResponse.status, apiResponse.headers, encodedData)) {
        throw new CloudflareChallengeError({
          sourceId: source.id,
          sourceName: source.name,
          url: source.baseUrl,
          requestUrl: lelUrl,
          status: apiResponse.status,
        });
      }
      throw new Error(`HTTP ${apiResponse.status} while fetching Scan-Manga pages.`);
    }

    const trimmed = encodedData.trim();
    if (!trimmed || trimmed.includes('error')) {
      throw new Error(`Scan-Manga API refused page payload: ${trimmed.slice(0, 120)}`);
    }

    const rawBinary = atob(trimmed);
    const compressedBytes = new Uint8Array(rawBinary.length);
    for (let i = 0; i < rawBinary.length; i += 1) {
      compressedBytes[i] = rawBinary.charCodeAt(i);
    }

    let inflated: string;
    if (typeof DecompressionStream === 'function') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(compressedBytes);
          controller.close();
        },
      }).pipeThrough(
        new DecompressionStream('deflate') as unknown as ReadableWritablePair<
          Uint8Array,
          Uint8Array
        >,
      );
      inflated = await new Response(stream).text();
    } else {
      throw new Error('DecompressionStream is unavailable in this runtime.');
    }

    const hexSuffix = chapterId.toString(16);
    const stripped = inflated.endsWith(hexSuffix)
      ? inflated.slice(0, -hexSuffix.length)
      : inflated;
    const reversed = stripped.split('').reverse().join('');
    const payload = JSON.parse(atob(reversed)) as {
      dN?: string;
      s?: string;
      v?: string;
      c?: string;
      p?: Record<string, { f?: string; e?: string }>;
    };

    if (!payload.dN || !payload.s || !payload.v || !payload.c || !payload.p) {
      return [];
    }

    const cdnBase = `https://${payload.dN}/${payload.s}/${payload.v}/${payload.c}`;
    return Object.entries(payload.p)
      .filter(([key, val]) => Number.isFinite(Number(key)) && Boolean(val?.f) && Boolean(val?.e))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, val], index) => ({
        index,
        imageUrl: `${cdnBase}/${val.f}.${val.e}`,
        headers: { Referer: targetChapterUrl },
      }));
  }
}

export const parserEngine = new UniversalParserEngine();

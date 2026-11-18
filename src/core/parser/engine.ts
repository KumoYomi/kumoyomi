import { extractChapterNumber } from '@/src/core/parser/chapterNumber';
import { parseFlexibleDate } from '@/src/core/parser/dateParser';
import {
  CloudflareChallengeError,
  extractJsonFromHtmlScript,
  type FetchedResponse,
  fetchSourceResponse,
  interpolateTemplate,
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
        : Array.from(scope.querySelectorAll(sel));
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

function renderJsonTemplate(template: string, item: unknown): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const val = getByDotPath(item, rawKey.trim());
    if (val === null || val === undefined) return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
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
    raw = renderJsonTemplate(extractor.jsonTemplate, item);
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
  responseType: 'html' | 'json' | 'json-html' | undefined,
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

    if (responseType === 'json') {
      const rawItems = getByDotPath(res.json, endpoint.itemsPath);
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
        hasNextPage: computeJsonHasNextPage(endpoint, res.json, items.length, page),
      };
    }

    const doc = getHtmlDocumentFromResponse(res, responseType, endpoint.request.jsonHtmlPath);
    const nodes = endpoint.itemSelector ? Array.from(doc.querySelectorAll(endpoint.itemSelector)) : [];

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
      hasNextPage = Boolean(doc.querySelector(endpoint.hasNextPageSelector));
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

    if (responseType === 'json') {
      const title = extractJsonField(res.json, cfg.fields.title, source.baseUrl, source.vars);
      const rawStatus = extractJsonField(res.json, cfg.fields.status, source.baseUrl, source.vars);
      const genresRaw = extractJsonField(res.json, cfg.fields.genres, source.baseUrl, source.vars);
      const altRaw = extractJsonField(res.json, cfg.fields.altTitles, source.baseUrl, source.vars);
      return {
        title: title || 'Untitled',
        url: mangaUrl,
        coverUrl:
          extractJsonField(res.json, cfg.fields.cover, source.baseUrl, source.vars) || undefined,
        author:
          extractJsonField(res.json, cfg.fields.author, source.baseUrl, source.vars) || undefined,
        artist:
          extractJsonField(res.json, cfg.fields.artist, source.baseUrl, source.vars) || undefined,
        description:
          extractJsonField(res.json, cfg.fields.description, source.baseUrl, source.vars) ||
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

    if (responseType === 'json') {
      const rawList = getByDotPath(res.json, cfg.itemsPath);
      const list = Array.isArray(rawList) ? rawList : [];
      const chapters: ParsedChapterItem[] = [];
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
        if (!title || !url) continue;
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
    const nodes = cfg.itemSelector ? Array.from(doc.querySelectorAll(cfg.itemSelector)) : [];
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

    if (responseType === 'json') {
      if (cfg.numberedPages) {
        return this.buildNumberedPages(source, res.json, chapterUrl, cfg.numberedPages);
      }
      if (!cfg.imageUrl) return [];
      const rawList = getByDotPath(res.json, cfg.itemsPath);
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
    const nodes = cfg.itemSelector ? Array.from(doc.querySelectorAll(cfg.itemSelector)) : [];
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
}

export const parserEngine = new UniversalParserEngine();

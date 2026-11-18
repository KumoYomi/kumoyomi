import { extractChapterNumber } from '@/src/core/parser/chapterNumber';
import { parseFlexibleDate } from '@/src/core/parser/dateParser';
import { type FetchedResponse, fetchSourceResponse } from '@/src/core/parser/httpClient';
import type {
  CatalogueEndpointConfig,
  FieldExtractor,
  MangaPublicationStatus,
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
    const found = Array.from(scope.querySelectorAll(sel));
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

function applyPostProcessing(
  rawValue: string,
  extractor: FieldExtractor,
  baseUrl: string,
  pageUrl?: string,
): string {
  let value = extractor.trim === false ? rawValue : rawValue.trim();

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

export function extractJsonField(
  item: unknown,
  extractor: FieldExtractor | undefined,
  baseUrl: string,
): string {
  if (!extractor) return '';
  const path =
    extractor.jsonPath ??
    (typeof extractor.attr === 'string' && extractor.attr !== 'text' ? extractor.attr : undefined);
  const val = getByDotPath(item, path);
  if (val === null || val === undefined) return '';
  const raw = Array.isArray(val)
    ? val.map(String).join(extractor.joinAll ?? ', ')
    : String(val);
  return applyPostProcessing(raw, extractor, baseUrl);
}

function getHtmlDocumentFromResponse(
  res: FetchedResponse,
  responseType: 'html' | 'json' | 'json-html' | undefined,
  jsonHtmlPath?: string,
): Document {
  if (responseType === 'json-html') {
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

export class UniversalParserEngine {
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
        const title = extractJsonField(entry, endpoint.fields.title, source.baseUrl);
        const url = extractJsonField(entry, endpoint.fields.url, source.baseUrl);
        if (!title || !url) continue;
        const coverUrl = extractJsonField(entry, endpoint.fields.cover, source.baseUrl) || undefined;
        const latestChapter =
          extractJsonField(entry, endpoint.fields.latestChapter, source.baseUrl) || undefined;
        items.push({ sourceId: source.id, title, url, coverUrl, latestChapter });
      }
      const hasNext = endpoint.hasNextPageJsonPath
        ? Boolean(getByDotPath(res.json, endpoint.hasNextPageJsonPath))
        : Boolean(endpoint.pageSize && items.length >= endpoint.pageSize);
      return { items, hasNextPage: hasNext };
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
      throw new Error(`La source "${source.name}" ne définit pas de catalogue populaire.`);
    }
    return this.getCatalogue(source, endpoint, { page });
  }

  getLatest(source: SourceConfig, page = 1): Promise<ParsedCataloguePage> {
    const endpoint = source.latest ?? source.popular;
    if (!endpoint) {
      throw new Error(`La source "${source.name}" ne définit pas de dernières sorties.`);
    }
    return this.getCatalogue(source, endpoint, { page });
  }

  search(source: SourceConfig, query: string, page = 1): Promise<ParsedCataloguePage> {
    const endpoint = source.search;
    if (!endpoint) {
      throw new Error(`La source "${source.name}" ne supporte pas la recherche.`);
    }
    return this.getCatalogue(source, endpoint, { page, query });
  }

  async getMangaDetails(source: SourceConfig, mangaUrl: string): Promise<ParsedMangaDetails> {
    const cfg = source.mangaDetails;
    const res = await fetchSourceResponse(source, cfg.request, { mangaUrl });
    const responseType = cfg.request.responseType ?? 'html';

    if (responseType === 'json') {
      const title = extractJsonField(res.json, cfg.fields.title, source.baseUrl);
      const rawStatus = extractJsonField(res.json, cfg.fields.status, source.baseUrl);
      const genresRaw = extractJsonField(res.json, cfg.fields.genres, source.baseUrl);
      return {
        title: title || 'Sans titre',
        url: mangaUrl,
        coverUrl: extractJsonField(res.json, cfg.fields.cover, source.baseUrl) || undefined,
        author: extractJsonField(res.json, cfg.fields.author, source.baseUrl) || undefined,
        artist: extractJsonField(res.json, cfg.fields.artist, source.baseUrl) || undefined,
        description: extractJsonField(res.json, cfg.fields.description, source.baseUrl) || undefined,
        status: mapPublicationStatus(rawStatus, cfg.statusMap),
        genres: genresRaw
          ? genresRaw
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean)
          : [],
      };
    }

    const doc = getHtmlDocumentFromResponse(res, responseType, cfg.request.jsonHtmlPath);
    const title = extractDomField(doc, cfg.fields.title, source.baseUrl, res.finalUrl);
    const rawStatus = extractDomField(doc, cfg.fields.status, source.baseUrl, res.finalUrl);
    const genresRaw = extractDomField(doc, cfg.fields.genres, source.baseUrl, res.finalUrl);
    const altRaw = extractDomField(doc, cfg.fields.altTitles, source.baseUrl, res.finalUrl);

    return {
      title: title || 'Sans titre',
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
    };
  }

  async getChapters(
    source: SourceConfig,
    mangaUrl: string,
    cachedDetailsHtml?: string,
  ): Promise<ParsedChapterItem[]> {
    const cfg = source.chapters;
    let items: ParsedChapterItem[] = [];

    if (cfg.request) {
      try {
        const res = await fetchSourceResponse(source, cfg.request, { mangaUrl });
        items = this.extractChaptersFromResponse(source, res, mangaUrl);
      } catch (err) {
        if (!cfg.fallbackInline || !cachedDetailsHtml) {
          throw err;
        }
      }
    }

    if (items.length === 0 && (cfg.fallbackInline || !cfg.request)) {
      const html =
        cachedDetailsHtml ??
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
        const title = extractJsonField(entry, cfg.fields.title, source.baseUrl);
        const url = extractJsonField(entry, cfg.fields.url, source.baseUrl);
        if (!title || !url) continue;
        const rawNum = extractJsonField(entry, cfg.fields.chapterNumber, source.baseUrl);
        const rawDate = extractJsonField(entry, cfg.fields.date, source.baseUrl);
        chapters.push({
          title,
          url,
          chapterNumber: rawNum ? Number.parseFloat(rawNum) : extractChapterNumber(title),
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
      const rawList = getByDotPath(res.json, cfg.itemsPath);
      const list = Array.isArray(rawList) ? rawList : [];
      const pages: ParsedPageItem[] = [];
      for (const entry of list) {
        const url = extractJsonField(entry, cfg.imageUrl, source.baseUrl);
        if (url) {
          pages.push({ index: pages.length, imageUrl: url });
        }
      }
      return pages;
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
}

export const parserEngine = new UniversalParserEngine();

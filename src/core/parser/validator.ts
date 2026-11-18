import type {
  CatalogueEndpointConfig,
  ChaptersEndpointConfig,
  MangaDetailsConfig,
  PagesEndpointConfig,
  RawSourceConfig,
  RepositoryManifest,
  SourceConfig,
  SourceTemplateConfig,
} from '@/src/core/types/source';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing or invalid required field: "${fieldPath}"`);
  }
  return value.trim();
}

export function validateHttpUrl(rawUrl: string, label = 'URL'): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid ${label}: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http:// or https://`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function validateTemplateConfig(raw: unknown): SourceTemplateConfig {
  if (!isRecord(raw)) {
    throw new Error('Invalid source template (JSON object expected).');
  }
  const id = assertNonEmptyString(raw.id, 'template.id');
  return {
    ...(raw as unknown as SourceTemplateConfig),
    id,
  };
}

export function validateRawSourceConfig(raw: unknown): RawSourceConfig {
  if (!isRecord(raw)) {
    throw new Error('Invalid source configuration (JSON object expected).');
  }
  const id = assertNonEmptyString(raw.id, 'source.id');
  const name = assertNonEmptyString(raw.name, 'source.name');
  const baseUrlRaw = assertNonEmptyString(raw.baseUrl, 'source.baseUrl');
  const baseUrl = validateHttpUrl(baseUrlRaw, `baseUrl (${id})`);

  return {
    ...(raw as unknown as RawSourceConfig),
    id,
    name,
    baseUrl,
    lang: typeof raw.lang === 'string' && raw.lang.trim() ? raw.lang.trim() : 'fr',
  };
}

export function validateRepositoryManifest(raw: unknown): RepositoryManifest {
  if (!isRecord(raw)) {
    throw new Error('Invalid repository manifest (JSON object expected).');
  }
  const name = assertNonEmptyString(raw.name, 'manifest.name');
  if (!Array.isArray(raw.sources)) {
    throw new Error('Invalid manifest: "sources" must be an array.');
  }

  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    sources: raw.sources as RepositoryManifest['sources'],
  };
}

function mergeCatalogueConfig(
  base?: Partial<CatalogueEndpointConfig>,
  override?: Partial<CatalogueEndpointConfig>,
): CatalogueEndpointConfig | undefined {
  if (!base && !override) return undefined;
  const request = override?.request ?? base?.request;
  const itemSelector = override?.itemSelector ?? base?.itemSelector;
  const itemsPath = override?.itemsPath ?? base?.itemsPath;
  const fields = {
    ...(base?.fields ?? {}),
    ...(override?.fields ?? {}),
  } as CatalogueEndpointConfig['fields'];
  if (!request || !fields.title || !fields.url) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    request,
    itemSelector,
    itemsPath,
    fields,
  };
}

function mergeDetailsConfig(
  base?: Partial<MangaDetailsConfig>,
  override?: Partial<MangaDetailsConfig>,
): MangaDetailsConfig {
  const request = override?.request ?? base?.request;
  if (!request) {
    throw new Error('Missing "mangaDetails.request" configuration.');
  }
  const fields = {
    ...(base?.fields ?? {}),
    ...(override?.fields ?? {}),
  } as MangaDetailsConfig['fields'];
  if (!fields.title) {
    throw new Error('Missing "mangaDetails.fields.title" selector.');
  }
  return {
    request,
    fields,
    statusMap: {
      ...(base?.statusMap ?? {}),
      ...(override?.statusMap ?? {}),
    },
  };
}

function mergeChaptersConfig(
  base?: Partial<ChaptersEndpointConfig>,
  override?: Partial<ChaptersEndpointConfig>,
): ChaptersEndpointConfig {
  const fields = {
    ...(base?.fields ?? {}),
    ...(override?.fields ?? {}),
  } as ChaptersEndpointConfig['fields'];
  if (!fields.title || !fields.url) {
    throw new Error('Missing "chapters.fields.title" or "url" selector.');
  }
  return {
    request: override && 'request' in override ? override.request : base?.request,
    fallbackInline: override?.fallbackInline ?? base?.fallbackInline,
    extractVarsFromDetails:
      override?.extractVarsFromDetails ?? base?.extractVarsFromDetails,
    itemsPath: override?.itemsPath ?? base?.itemsPath,
    itemSelector: override?.itemSelector ?? base?.itemSelector,
    fields,
    reverseOrder: override?.reverseOrder ?? base?.reverseOrder,
  };
}

function mergePagesConfig(
  base?: Partial<PagesEndpointConfig>,
  override?: Partial<PagesEndpointConfig>,
): PagesEndpointConfig {
  const request = override?.request ?? base?.request;
  const imageUrl = override?.imageUrl ?? base?.imageUrl;
  const numberedPages = override?.numberedPages ?? base?.numberedPages;
  if (!request || (!imageUrl && !numberedPages)) {
    throw new Error(
      'Missing "pages.request" or "pages.imageUrl" / "pages.numberedPages" configuration.',
    );
  }
  return {
    request,
    itemsPath: override?.itemsPath ?? base?.itemsPath,
    itemSelector: override?.itemSelector ?? base?.itemSelector,
    imageUrl,
    numberedPages,
    scriptJson: override?.scriptJson ?? base?.scriptJson,
    scriptArrayRegex: override?.scriptArrayRegex ?? base?.scriptArrayRegex,
  };
}

export function resolveSourceWithTemplates(
  raw: RawSourceConfig,
  templates: Map<string, SourceTemplateConfig>,
): SourceConfig {
  const validatedRaw = validateRawSourceConfig(raw);
  const template = validatedRaw.extends ? templates.get(validatedRaw.extends) : undefined;
  if (validatedRaw.extends && !template) {
    throw new Error(
      `Source "${validatedRaw.name}" extends template "${validatedRaw.extends}" which could not be found.`,
    );
  }

  return {
    id: validatedRaw.id,
    name: validatedRaw.name,
    lang: validatedRaw.lang ?? template?.lang ?? 'fr',
    baseUrl: validatedRaw.baseUrl,
    iconUrl: validatedRaw.iconUrl,
    nsfw: validatedRaw.nsfw,
    extends: validatedRaw.extends,
    vars: {
      ...(template?.vars ?? {}),
      ...(validatedRaw.vars ?? {}),
    },
    headers: {
      ...(template?.headers ?? {}),
      ...(validatedRaw.headers ?? {}),
    },
    warmupUrl: validatedRaw.warmupUrl ?? template?.warmupUrl,
    popular: mergeCatalogueConfig(template?.popular, validatedRaw.popular),
    latest: mergeCatalogueConfig(template?.latest, validatedRaw.latest),
    search: mergeCatalogueConfig(template?.search, validatedRaw.search),
    mangaDetails: mergeDetailsConfig(template?.mangaDetails, validatedRaw.mangaDetails),
    chapters: mergeChaptersConfig(template?.chapters, validatedRaw.chapters),
    pages: mergePagesConfig(template?.pages, validatedRaw.pages),
  };
}

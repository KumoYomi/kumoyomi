import type {
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
    throw new Error(`Champ requis manquant ou invalide : "${fieldPath}"`);
  }
  return value.trim();
}

export function validateHttpUrl(rawUrl: string, label = 'URL'): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`${label} invalide : "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} doit utiliser http:// ou https://`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function validateTemplateConfig(raw: unknown): SourceTemplateConfig {
  if (!isRecord(raw)) {
    throw new Error('Modèle de source invalide (objet attendu).');
  }
  const id = assertNonEmptyString(raw.id, 'template.id');
  return {
    ...(raw as unknown as SourceTemplateConfig),
    id,
  };
}

export function validateRawSourceConfig(raw: unknown): RawSourceConfig {
  if (!isRecord(raw)) {
    throw new Error('Configuration source invalide (objet attendu).');
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
    throw new Error('Manifeste de dépôt invalide (objet JSON attendu).');
  }
  const name = assertNonEmptyString(raw.name, 'manifest.name');
  if (!Array.isArray(raw.sources)) {
    throw new Error('Manifeste invalide : "sources" doit être un tableau.');
  }

  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    sources: raw.sources as RepositoryManifest['sources'],
  };
}

function mergeDetailsConfig(
  base?: Partial<MangaDetailsConfig>,
  override?: Partial<MangaDetailsConfig>,
): MangaDetailsConfig {
  const request = override?.request ?? base?.request;
  if (!request) {
    throw new Error('Configuration "mangaDetails.request" manquante.');
  }
  const fields = {
    ...(base?.fields ?? {}),
    ...(override?.fields ?? {}),
  } as MangaDetailsConfig['fields'];
  if (!fields.title) {
    throw new Error('Sélecteur "mangaDetails.fields.title" manquant.');
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
    throw new Error('Sélecteurs "chapters.fields.title" ou "url" manquants.');
  }
  return {
    request: override?.request ?? base?.request,
    fallbackInline: override?.fallbackInline ?? base?.fallbackInline,
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
  if (!request || !imageUrl) {
    throw new Error('Configuration "pages.request" ou "pages.imageUrl" manquante.');
  }
  return {
    request,
    itemsPath: override?.itemsPath ?? base?.itemsPath,
    itemSelector: override?.itemSelector ?? base?.itemSelector,
    imageUrl,
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
      `La source "${validatedRaw.name}" hérite du modèle "${validatedRaw.extends}" qui est introuvable.`,
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
    popular: validatedRaw.popular ?? template?.popular,
    latest: validatedRaw.latest ?? template?.latest,
    search: validatedRaw.search ?? template?.search,
    mangaDetails: mergeDetailsConfig(template?.mangaDetails, validatedRaw.mangaDetails),
    chapters: mergeChaptersConfig(template?.chapters, validatedRaw.chapters),
    pages: mergePagesConfig(template?.pages, validatedRaw.pages),
  };
}

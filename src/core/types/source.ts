export interface ReplaceRule {
  pattern: string;
  replacement: string;
  flags?: string;
}

export interface FieldExtractor {
  /** Sélecteur CSS (ou liste ordonnée de repli) relatif à l'élément courant. Omis = lit l'élément courant. */
  selector?: string | string[];
  /** Attribut(s) à extraire par ordre de priorité ("text", "ownText", "html", "href", "data-src", "src", etc.) ou chemin JSON. */
  attr?: string | string[];
  /** Pour les couples <dt>/<dd> ou libellés adjacents : cherche les éléments dont le texte correspond et lit nextElementSibling. */
  labelMatch?: string[];
  /** Concatène tous les éléments trouvés avec ce séparateur au lieu de prendre uniquement le premier. */
  joinAll?: string;
  /** Expression régulière appliquée au résultat (capture le groupe 1 si présent, sinon le match complet). */
  regex?: string;
  /** Remplacements successifs appliqués après extraction. */
  replace?: ReplaceRule[];
  /** Convertit une URL relative en URL absolue à partir du baseUrl de la source. */
  absoluteUrl?: boolean;
  /** Supprime les espaces/retours à la ligne autour de la valeur (true par défaut). */
  trim?: boolean;
  /** Chemin pointé (ou liste ordonnée de chemins) utilisé dans un contexte JSON. */
  jsonPath?: string | string[];
  /** Gabarit texte pour assembler plusieurs champs JSON (ex: "Chapitre {{num}} - {{title}}"). */
  jsonTemplate?: string;
  /** Préfixe ajouté si la valeur extraite est non vide (supporte {{baseUrl}}). */
  prefix?: string;
  /** Suffixe ajouté si la valeur extraite est non vide (supporte {{baseUrl}}). */
  suffix?: string;
  /** Décode les entités HTML (&amp;, &#039;, etc.). */
  decodeHtmlEntities?: boolean;
}

export type ResponseType = 'html' | 'json' | 'json-html';

export interface RequestConfig {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  formBody?: Record<string, string>;
  jsonBody?: Record<string, unknown>;
  responseType?: ResponseType;
  /** Chemin pointé vers le fragment HTML quand responseType === 'json-html' (ex: "data.html"). */
  jsonHtmlPath?: string;
}

export interface CatalogueEndpointConfig {
  request: RequestConfig;
  itemsPath?: string;
  itemSelector?: string;
  fields: {
    title: FieldExtractor;
    url: FieldExtractor;
    cover?: FieldExtractor;
    latestChapter?: FieldExtractor;
  };
  hasNextPageSelector?: string;
  hasNextPageJsonPath?: string;
  hasNextPageCalc?: {
    totalPath: string;
    limitPath?: string;
    pagePath?: string;
    pageSize?: number;
  };
  pageSize?: number;
}

export type MangaPublicationStatus =
  | 'ongoing'
  | 'completed'
  | 'hiatus'
  | 'cancelled'
  | 'unknown';

export interface MangaDetailsConfig {
  request: RequestConfig;
  fields: {
    title: FieldExtractor;
    cover?: FieldExtractor;
    author?: FieldExtractor;
    artist?: FieldExtractor;
    description?: FieldExtractor;
    status?: FieldExtractor;
    genres?: FieldExtractor;
    altTitles?: FieldExtractor;
  };
  statusMap?: Record<string, MangaPublicationStatus>;
}

export interface ChaptersEndpointConfig {
  request?: RequestConfig;
  /** Si true, bascule sur les sélecteurs appliqués au HTML de la fiche manga si la requête échoue ou est vide. */
  fallbackInline?: boolean;
  itemsPath?: string;
  itemSelector?: string;
  fields: {
    title: FieldExtractor;
    url: FieldExtractor;
    date?: FieldExtractor;
    chapterNumber?: FieldExtractor;
  };
  reverseOrder?: boolean;
}

export interface NumberedPagesConfig {
  countJsonPath: string;
  baseUrlJsonPath: string;
  padStart?: number;
  extension?: string;
  stripSuffixes?: string[];
  stripTokensFromScript?: {
    url: string;
    regexes: string[];
    minLength?: number;
    fallbackTokens?: string[];
  };
}

export interface PagesEndpointConfig {
  request: RequestConfig;
  itemsPath?: string;
  itemSelector?: string;
  imageUrl?: FieldExtractor;
  numberedPages?: NumberedPagesConfig;
}

export interface SourceConfig {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  iconUrl?: string;
  nsfw?: boolean;
  extends?: string;
  vars?: Record<string, string>;
  headers?: Record<string, string>;
  /** URL optionnelle visitée une fois en cas de HTTP 403 non-Cloudflare (cookie de session). */
  warmupUrl?: string;
  popular?: CatalogueEndpointConfig;
  latest?: CatalogueEndpointConfig;
  search?: CatalogueEndpointConfig;
  mangaDetails: MangaDetailsConfig;
  chapters: ChaptersEndpointConfig;
  pages: PagesEndpointConfig;
}

export interface SourceTemplateConfig {
  id: string;
  name?: string;
  lang?: string;
  vars?: Record<string, string>;
  headers?: Record<string, string>;
  warmupUrl?: string;
  popular?: CatalogueEndpointConfig;
  latest?: CatalogueEndpointConfig;
  search?: CatalogueEndpointConfig;
  mangaDetails?: Partial<MangaDetailsConfig>;
  chapters?: Partial<ChaptersEndpointConfig>;
  pages?: Partial<PagesEndpointConfig>;
}

export type RawSourceConfig = Partial<SourceConfig> & {
  id: string;
  name: string;
  baseUrl: string;
};

export interface RepositoryManifest {
  name: string;
  description?: string;
  version?: string;
  /** Modèles inline ou chemins relatifs vers des fichiers _templates/*.json */
  templates?: Array<SourceTemplateConfig | string>;
  /** Sources inline ou chemins relatifs vers des fichiers sources/*.json */
  sources: Array<RawSourceConfig | string>;
}

export interface ParsedCatalogueItem {
  sourceId: string;
  title: string;
  url: string;
  coverUrl?: string;
  latestChapter?: string;
}

export interface ParsedCataloguePage {
  items: ParsedCatalogueItem[];
  hasNextPage: boolean;
}

export interface ParsedMangaDetails {
  title: string;
  url: string;
  coverUrl?: string;
  author?: string;
  artist?: string;
  description?: string;
  status: MangaPublicationStatus;
  genres: string[];
  altTitles?: string[];
  rawHtml?: string;
}

export interface ParsedChapterItem {
  title: string;
  url: string;
  chapterNumber: number | null;
  publishedAt?: number;
}

export interface ParsedPageItem {
  index: number;
  imageUrl: string;
}

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
  /** Décode du Base64 puis inverse la chaîne (utilisé par certains thèmes comme ScanReader). */
  base64Reverse?: boolean;
}

export type ResponseType = 'html' | 'json' | 'json-html' | 'nextjs-flight';

export interface ScriptJsonExtractionConfig {
  /** Optional CSS selector targeting the <script> element (e.g. "script#__NEXT_DATA__"). Defaults to scanning all <script> tags. */
  selector?: string;
  /** Optional regex applied to script text; capture group 1 (or full match) must be valid JSON (e.g. "ts_reader\\.run\\((\\{[\\s\\S]*?\\})\\)\\s*;?"). */
  regex?: string;
}

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
  /** Extract embedded JSON from <script> tags inside an HTML document (e.g. __NEXT_DATA__, ts_reader.run). */
  scriptJson?: ScriptJsonExtractionConfig;
  /** Clés requises pour extraire les objets cibles d'un payload Next.js App Router (`self.__next_f.push`). */
  flightMatchKeys?: string[];
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
  /** Variables extraites depuis le HTML de la fiche manga avant d'envoyer chapters.request (ex: nonce, mangaId). */
  extractVarsFromDetails?: Record<string, FieldExtractor>;
  /** Si `itemsPath` pointe vers un dictionnaire `{ key: entry }`, injecte la clé dans ce champ avant mapping. */
  objectEntriesKeyField?: string;
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
  /** Extraction optionnelle depuis un script HTML avant repli sur itemSelector. */
  scriptJson?: ScriptJsonExtractionConfig & { itemsPath?: string };
  /** Expression régulière (groupe 1) répétée sur le texte de la page (tableaux JS inline). */
  scriptArrayRegex?: string;
  /** Sélectionne un sous-objet dans un tableau JSON (ex: chapitre par ID) puis lit ou parse son tableau d'images. */
  findEntry?: {
    itemsPath?: string;
    matchField: string;
    matchTemplate: string;
    parseJsonArrayField?: string;
    itemsArrayField?: string;
  };
  /** Extrait une liste de liens de pages individuelles (ex: menu <select>) puis récupère l'image sur chaque page. */
  followPageLinks?: {
    itemSelector: string;
    urlAttr?: string;
    imageSelector: string;
    imageAttr?: string | string[];
  };
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
  popular?: Partial<CatalogueEndpointConfig>;
  latest?: Partial<CatalogueEndpointConfig>;
  search?: Partial<CatalogueEndpointConfig>;
  mangaDetails?: Partial<MangaDetailsConfig>;
  chapters?: Partial<ChaptersEndpointConfig>;
  pages?: Partial<PagesEndpointConfig>;
}

export type RawSourceConfig = Omit<
  Partial<SourceConfig>,
  'popular' | 'latest' | 'search' | 'mangaDetails' | 'chapters' | 'pages'
> & {
  id: string;
  name: string;
  baseUrl: string;
  popular?: Partial<CatalogueEndpointConfig>;
  latest?: Partial<CatalogueEndpointConfig>;
  search?: Partial<CatalogueEndpointConfig>;
  mangaDetails?: Partial<MangaDetailsConfig>;
  chapters?: Partial<ChaptersEndpointConfig>;
  pages?: Partial<PagesEndpointConfig>;
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
  rawJson?: unknown;
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

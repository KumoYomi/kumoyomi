#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SUPPORTED_THEMES = new Set([
  'origines',
  'madara',
  'mangathemesia',
  'pizzareader',
  'fuzzydoodle',
  'mmrcms',
  'scanreader',
]);

function parseArgs(argv) {
  const args = { input: '', out: '', pretty: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      args.input = argv[++i] ?? '';
    } else if (arg === '--out' || arg === '-o') {
      args.out = argv[++i] ?? '';
    } else if (!args.input && !arg.startsWith('-')) {
      args.input = arg;
    }
  }
  return args;
}

function findFilesRecursive(dir, predicate, results = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      findFilesRecursive(fullPath, predicate, results);
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function slugifyId(name, lang) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return lang && !base.endsWith(`-${lang}`) ? `${base}-${lang}` : base;
}

function extractMatch(text, regex) {
  const m = regex.exec(text);
  return m?.[1]?.trim();
}

export function convertKeiyoushiDirectory(extDir) {
  const gradleKts = join(extDir, 'build.gradle.kts');
  const gradleGroovy = join(extDir, 'build.gradle');
  const gradleContent = existsSync(gradleKts)
    ? readFileSync(gradleKts, 'utf8')
    : existsSync(gradleGroovy)
      ? readFileSync(gradleGroovy, 'utf8')
      : '';

  const ktFiles = existsSync(join(extDir, 'src'))
    ? findFilesRecursive(join(extDir, 'src'), (p) => p.endsWith('.kt'))
    : [];
  const ktContent = ktFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

  const combined = `${gradleContent}\n${ktContent}`;

  const rawTheme =
    extractMatch(gradleContent, /\btheme\s*=\s*["']([^"']+)["']/) ??
    extractMatch(gradleContent, /\bthemePkg\s*=\s*["']([^"']+)["']/) ??
    extractMatch(gradleContent, /\bthemeClass\s*=\s*["']([^"']+)["']/) ??
    extractMatch(
      ktContent,
      /:\s*(Origines|Madara|MadaraNoAjax|MangaThemesia|PizzaReader|FuzzyDoodle|MMRCMS|ScanReaderTheme)\s*\(/i,
    );

  const normalizedTheme = rawTheme
    ?.toLowerCase()
    .replace('madaranoajax', 'madara')
    .replace('scanreadertheme', 'scanreader');
  if (!normalizedTheme || !SUPPORTED_THEMES.has(normalizedTheme)) {
    return {
      ok: false,
      reason: `Thème "${rawTheme ?? 'custom'}" non supporté automatiquement (nécessite une fiche JSON manuelle).`,
      dir: extDir,
    };
  }

  const sourceBlockRe = /\bsource\s*\{([\s\S]*?)\}/g;
  const sourceBlocks = [];
  for (const m of gradleContent.matchAll(sourceBlockRe)) {
    sourceBlocks.push({
      name: extractMatch(m[1], /\bname\s*=\s*["']([^"']+)["']/),
      lang: extractMatch(m[1], /\blang\s*=\s*["']([^"']+)["']/),
      baseUrl: extractMatch(m[1], /\bbaseUrl\s*=\s*["']([^"']+)["']/),
    });
  }
  const preferredBlock = sourceBlocks.find((b) => b.lang === 'fr') ?? sourceBlocks[0];
  const strippedGradle = gradleContent.replace(sourceBlockRe, '');

  const name =
    preferredBlock?.name ??
    extractMatch(strippedGradle, /\bname\s*=\s*["']([^"']+)["']/) ??
    extractMatch(gradleContent, /\bextName\s*=\s*["']([^"']+)["']/) ??
    extractMatch(ktContent, /override\s+val\s+name\s*=\s*"([^"]+)"/) ??
    basename(extDir);

  const baseUrl =
    preferredBlock?.baseUrl ??
    extractMatch(strippedGradle, /\bbaseUrl\s*=\s*["']([^"']+)["']/) ??
    extractMatch(gradleContent, /\bbaseUrl\s*=\s*["']([^"']+)["']/) ??
    extractMatch(ktContent, /override\s+val\s+baseUrl\s*=\s*"([^"]+)"/);

  if (!baseUrl) {
    return { ok: false, reason: 'baseUrl introuvable dans build.gradle / .kt', dir: extDir };
  }

  const lang =
    preferredBlock?.lang ??
    extractMatch(strippedGradle, /\blang\s*=\s*["']([^"']+)["']/) ??
    extractMatch(gradleContent, /\bextLang\s*=\s*["']([^"']+)["']/) ??
    extractMatch(ktContent, /override\s+val\s+lang\s*=\s*"([^"]+)"/) ??
    'fr';

  const nsfw =
    /ContentWarning\.NSFW|isNsfw\s*=\s*true/.test(combined) || undefined;

  const vars = {};
  const mangaPath = extractMatch(ktContent, /override\s+val\s+mangaPath\s*=\s*"([^"]+)"/);
  if (mangaPath) vars.mangaPath = mangaPath.replace(/^\/+|\/+$/g, '');

  const mangaSubString = extractMatch(
    ktContent,
    /override\s+val\s+mangaSubString\s*=\s*"([^"]+)"/,
  );
  if (mangaSubString) vars.mangaSubString = mangaSubString.replace(/^\/+|\/+$/g, '');

  const mangaUrlDir = extractMatch(
    ktContent,
    /override\s+val\s+mangaUrlDirectory\s*=\s*"([^"]+)"/,
  );
  if (mangaUrlDir) vars.mangaUrlDirectory = mangaUrlDir.replace(/^\/+|\/+$/g, '');

  const itemPath = extractMatch(ktContent, /override\s+val\s+itemPath\s*=\s*"([^"]+)"/);
  if (itemPath) vars.itemPath = itemPath.replace(/^\/+|\/+$/g, '');

  const apiPath = extractMatch(ktContent, /override\s+val\s+apiPath\s*=\s*"([^"]+)"/);
  if (apiPath) vars.apiPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;

  const config = {
    id: slugifyId(name, lang),
    name,
    lang,
    extends: normalizedTheme,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    ...(nsfw ? { nsfw: true } : {}),
    ...(Object.keys(vars).length > 0 ? { vars } : {}),
  };

  return { ok: true, config };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.log(
      'Usage: node tools/mihon-converter/convert.mjs --input <dossier-extension-keiyoushi> [--out <fichier.json>]',
    );
    process.exit(1);
  }

  const inputPath = resolve(args.input);
  const isSingle =
    existsSync(join(inputPath, 'build.gradle.kts')) ||
    existsSync(join(inputPath, 'build.gradle'));

  if (isSingle) {
    const res = convertKeiyoushiDirectory(inputPath);
    if (!res.ok) {
      console.error(`❌ Conversion impossible : ${res.reason}`);
      process.exit(2);
    }
    const json = JSON.stringify(res.config, null, 2);
    if (args.out) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true });
      writeFileSync(resolve(args.out), `${json}\n`, 'utf8');
      console.log(`✅ Source générée : ${args.out}`);
    } else {
      console.log(json);
    }
    return;
  }

  const converted = [];
  const skipped = [];
  for (const entry of readdirSync(inputPath)) {
    const subDir = join(inputPath, entry);
    if (!statSync(subDir).isDirectory()) continue;
    if (
      !existsSync(join(subDir, 'build.gradle.kts')) &&
      !existsSync(join(subDir, 'build.gradle'))
    ) {
      continue;
    }
    const res = convertKeiyoushiDirectory(subDir);
    if (res.ok) converted.push(res.config);
    else skipped.push({ dir: entry, reason: res.reason });
  }

  const outputObj = {
    convertedCount: converted.length,
    skippedCount: skipped.length,
    sources: converted,
    skipped,
  };
  const json = JSON.stringify(outputObj, null, 2);
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(resolve(args.out), `${json}\n`, 'utf8');
    console.log(`✅ ${converted.length} source(s) convertie(s), ${skipped.length} ignorée(s).`);
  } else {
    console.log(json);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

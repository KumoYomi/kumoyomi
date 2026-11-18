const CHAPTER_PATTERNS: RegExp[] = [
  /(?:chapitre|chapter|chap|ch|ep|episode|épisode)\.?\s*#?\s*(\d+(?:[.,]\d+)?)/i,
  /(?:^|\s|[-–—_#])(\d+(?:[.,]\d+)?)(?:\s*(?:vf|vostfr|fr|en)?$)/i,
  /(\d+(?:[.,]\d+)?)/,
];

export function extractChapterNumber(title: string): number | null {
  const cleaned = title.trim();
  if (!cleaned) return null;

  for (const pattern of CHAPTER_PATTERNS) {
    const match = pattern.exec(cleaned);
    if (match?.[1]) {
      const normalized = match[1].replace(',', '.');
      const num = Number.parseFloat(normalized);
      if (Number.isFinite(num)) {
        return num;
      }
    }
  }
  return null;
}

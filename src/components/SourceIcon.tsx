import { useEffect, useMemo, useState } from 'react';

interface SourceIconProps {
  name: string;
  iconUrl?: string;
  baseUrl?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<SourceIconProps['size']>, string> = {
  xs: 'h-4 w-4 rounded-[5px] text-[8px]',
  sm: 'h-5 w-5 rounded-md text-[9px]',
  md: 'h-7 w-7 rounded-lg text-[11px]',
};

const BADGE_PALETTE = [
  'bg-sky-500/20 text-sky-300 ring-sky-400/30',
  'bg-indigo-500/20 text-indigo-300 ring-indigo-400/30',
  'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30',
  'bg-amber-500/20 text-amber-300 ring-amber-400/30',
  'bg-rose-500/20 text-rose-300 ring-rose-400/30',
  'bg-violet-500/20 text-violet-300 ring-violet-400/30',
];

function computeInitials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9À-ÿ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
  }
  return (words[0] ?? name).slice(0, 2).toUpperCase() || '?';
}

function pickPaletteClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return BADGE_PALETTE[Math.abs(hash) % BADGE_PALETTE.length]!;
}

/**
 * Displays a crisp source icon (`iconUrl`, site `/favicon.ico` fallback, or monogram badge).
 */
export function SourceIcon({
  name,
  iconUrl,
  baseUrl,
  size = 'sm',
  className = '',
}: SourceIconProps) {
  const candidates = useMemo(() => {
    const list: string[] = [];
    if (iconUrl?.trim()) {
      list.push(iconUrl.trim());
    }
    if (baseUrl?.trim()) {
      try {
        const origin = new URL(baseUrl).origin;
        list.push(`${origin}/favicon.ico`);
      } catch {
        // Ignore invalid baseUrl
      }
    }
    return list;
  }, [iconUrl, baseUrl]);

  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [iconUrl, baseUrl]);

  const sizeCls = SIZE_CLASSES[size];
  const activeSrc = candidates[candidateIdx];

  if (!activeSrc) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center font-bold ring-1 ${sizeCls} ${pickPaletteClass(name)} ${className}`}
      >
        {computeInitials(name)}
      </span>
    );
  }

  return (
    <img
      src={activeSrc}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setCandidateIdx((idx) => idx + 1)}
      className={`shrink-0 bg-zinc-900/60 object-cover ring-1 ring-white/10 ${sizeCls} ${className}`}
    />
  );
}

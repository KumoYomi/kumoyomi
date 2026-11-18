import { Check, ChevronDown } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  icon?: ReactNode;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  align?: 'auto' | 'left' | 'right';
  size?: 'xs' | 'sm';
  disabled?: boolean;
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  buttonClassName = '',
  align = 'auto',
  size = 'sm',
  disabled = false,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUp(spaceBelow < 220 && spaceAbove > spaceBelow);

    if (align === 'right') {
      setAlignRight(true);
    } else if (align === 'left') {
      setAlignRight(false);
    } else {
      const spaceRight = window.innerWidth - rect.left;
      setAlignRight(spaceRight < 220 && rect.right > 200);
    }

    setActiveIndex(selectedIndex);
  }, [open, align, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (!open) {
        e.preventDefault();
        setOpen(true);
        return;
      }
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, options.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % Math.max(1, options.length));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const target = options[activeIndex];
      if (target) {
        onChange(target.value);
        setOpen(false);
      }
    }
  }

  const paddingClass =
    size === 'xs' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs sm:text-[13px]';

  return (
    <div ref={rootRef} data-no-stage-tap="true" className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--ky-border)] bg-[var(--ky-surface-2)] font-medium text-[var(--ky-text)] transition hover:border-[var(--ky-border-strong)] hover:bg-[var(--ky-surface-hover)] focus:border-[var(--ky-accent-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ky-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 ${paddingClass} ${buttonClassName}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selectedOption?.icon}
          <span className="truncate">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--ky-text-muted)] transition-transform duration-150 ${
            open ? 'rotate-180 text-[var(--ky-accent-text)]' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`ky-dropdown-panel absolute z-50 max-h-64 min-w-[max(100%,11rem)] max-w-[min(86vw,20rem)] overflow-y-auto rounded-2xl p-1.5 backdrop-blur-xl ${
            openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${alignRight ? 'right-0' : 'left-0'}`}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === activeIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition ${
                  isSelected
                    ? 'ky-pill-active font-semibold'
                    : isFocused
                      ? 'bg-[var(--ky-surface-hover)] text-[var(--ky-text-heading)]'
                      : 'text-[var(--ky-text-secondary)] hover:bg-[var(--ky-surface-hover)] hover:text-[var(--ky-text-heading)]'
                }`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {opt.badge && (
                    <span className="rounded-md bg-black/20 px-1.5 py-0.5 font-mono text-[10px] opacity-80">
                      {opt.badge}
                    </span>
                  )}
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

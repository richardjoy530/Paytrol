'use client';

import { CheckIcon, VerifiedIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** A selectable person row, used wherever people are picked for a split. */
export default function PersonToggle({
  name,
  subtitle,
  photo,
  verified,
  selected,
  onToggle,
  trailing,
}: {
  name: string;
  subtitle?: string | null;
  photo?: string | null;
  verified?: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Shown at the right edge, e.g. this person's share. */
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-primary-line bg-primary-soft' : 'border-line bg-surface hover:bg-surface-soft'
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
          selected ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'
        )}
      >
        {selected && <CheckIcon size={14} strokeWidth={2.4} />}
      </span>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="h-8 w-8 shrink-0 rounded-full" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-soft text-xs font-bold text-muted">
          {name[0]?.toUpperCase() || '?'}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs font-semibold text-ink">
          <span className="truncate">{name}</span>
          {verified && (
            <span title="Has a Paytrol account" className="shrink-0 text-primary">
              <VerifiedIcon size={14} />
              <span className="sr-only">Has a Paytrol account</span>
            </span>
          )}
        </span>
        {subtitle && <span className="block truncate text-[11px] text-muted">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}

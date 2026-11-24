'use client';

import { useId } from 'react';
import { BTN, BTN_SIZE } from '@/lib/ui';
import { cn } from '@/lib/utils';

/** Add a guest by name without leaving the split. */
export default function QuickAddGuest({
  value,
  onChange,
  onAdd,
  adding,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  adding?: boolean;
}) {
  const inputId = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-xs font-medium text-muted">
        Someone else? Add them as a guest
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={80}
          placeholder="Guest name"
          enterKeyHint="done"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink outline-none focus:border-line-strong"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!value.trim() || adding}
          className={cn(BTN.secondary, BTN_SIZE.md)}
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

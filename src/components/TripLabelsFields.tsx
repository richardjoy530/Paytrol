'use client';

import { useId, useState } from 'react';
import { BTN, BTN_SIZE } from '@/lib/ui';
import { cn } from '@/lib/utils';
import {
  cleanTripTag,
  TRIP_NAME_MAX_LENGTH,
  TRIP_TAG_MAX_LENGTH,
  TRIP_TAGS_MAX,
} from '@/lib/trip-labels';

interface TripLabelsFieldsProps {
  name: string;
  onNameChange: (name: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  /** Tags used on earlier trips, offered as one-tap choices. */
  suggestions?: string[];
}

/** Optional name and tags for a trip. */
export default function TripLabelsFields({
  name,
  onNameChange,
  tags,
  onTagsChange,
  suggestions = [],
}: TripLabelsFieldsProps) {
  const nameId = useId();
  const tagId = useId();
  const [tagDraft, setTagDraft] = useState('');

  const hasTag = (tag: string) => tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase());
  const atLimit = tags.length >= TRIP_TAGS_MAX;

  const addTag = (value: string) => {
    const tag = cleanTripTag(value);
    if (!tag || hasTag(tag) || atLimit) return;
    onTagsChange([...tags, tag]);
  };

  const commitDraft = () => {
    // Allow typing or pasting several tags separated by commas.
    let next = [...tags];
    for (const part of tagDraft.split(',')) {
      const tag = cleanTripTag(part);
      if (!tag || next.length >= TRIP_TAGS_MAX) continue;
      if (next.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) continue;
      next = [...next, tag];
    }
    if (next.length !== tags.length) onTagsChange(next);
    setTagDraft('');
  };

  const removeTag = (tag: string) => onTagsChange(tags.filter((item) => item !== tag));

  const openSuggestions = suggestions.filter((tag) => !hasTag(tag)).slice(0, 8);

  return (
    <div className="space-y-3">
      <label htmlFor={nameId} className="block space-y-1.5">
        <span className="text-xs font-medium text-muted">
          Trip name <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          id={nameId}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          maxLength={TRIP_NAME_MAX_LENGTH}
          placeholder="e.g. Office run, Goa weekend"
          className="h-11 w-full rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink outline-none focus:border-line-strong"
        />
      </label>

      <div className="space-y-1.5">
        <label htmlFor={tagId} className="block text-xs font-medium text-muted">
          Tags <span className="font-normal text-muted">(optional, up to {TRIP_TAGS_MAX})</span>
        </label>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => removeTag(tag)}
                className="inline-flex items-center gap-1 rounded-full border border-primary-line bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary"
                aria-label={`Remove tag ${tag}`}
              >
                <span>#{tag}</span>
                <span aria-hidden="true" className="text-muted">×</span>
              </button>
            ))}
          </div>
        )}

        {!atLimit && (
          <div className="flex items-stretch gap-2">
            <input
              id={tagId}
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  commitDraft();
                } else if (event.key === 'Backspace' && !tagDraft && tags.length > 0) {
                  removeTag(tags[tags.length - 1]);
                }
              }}
              onBlur={commitDraft}
              maxLength={TRIP_TAG_MAX_LENGTH * 3}
              placeholder="office, weekend…"
              enterKeyHint="done"
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink outline-none focus:border-line-strong"
            />
            <button
              type="button"
              onClick={commitDraft}
              disabled={!tagDraft.trim()}
              className={cn(BTN.secondary, BTN_SIZE.md)}
            >
              Add
            </button>
          </div>
        )}

        {!atLimit && openSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {openSuggestions.map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => addTag(tag)}
                className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[11px] text-muted hover:text-ink"
              >
                + {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

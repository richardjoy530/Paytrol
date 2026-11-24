// Shared button styles, so every screen uses the same sizes and colours.
const BTN_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-colors active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100';

export const BTN_SIZE = {
  sm: 'h-9 px-3.5 text-xs',
  md: 'h-11 px-4 text-sm',
} as const;

export const BTN = {
  primary: `${BTN_BASE} bg-primary text-on-primary hover:bg-primary-hover`,
  secondary: `${BTN_BASE} border border-line bg-surface text-ink hover:bg-surface-soft`,
  soft: `${BTN_BASE} bg-primary-soft text-primary hover:bg-primary-line/40`,
  danger: `${BTN_BASE} bg-danger text-on-primary hover:bg-danger-hover`,
  dangerOutline: `${BTN_BASE} border border-danger-line bg-surface text-danger hover:bg-danger-soft`,
} as const;

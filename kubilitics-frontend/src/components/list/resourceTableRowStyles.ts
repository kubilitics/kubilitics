import { cn } from '@/lib/utils';

// Non-component exports for ResourceTableRow live here so ResourceTableRow.tsx
// can export only its component. This keeps React Fast Refresh happy — mixing
// component and non-component exports in the same module invalidates HMR and
// forces a full-page reload on every edit.

export const ROW_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: (index: number) => ({ delay: index * 0.03, duration: 0.2 }),
};

/** CSS class for row entrance animation — replaces motion.tr entirely. */
export const rowEntranceClass = 'animate-row-entrance';

/** Get inline style for staggered row entrance. Only first 20 rows get stagger delay for perf. */
export function rowEntranceStyle(index: number): React.CSSProperties | undefined {
  if (index <= 0) return undefined;
  if (index > 20) return undefined;
  return { animationDelay: `${index * 30}ms` };
}

/**
 * Class names for data rows so the table feels like "card strips":
 * soft border, padding, hover lift, transition. Use with <tr>.
 */
export const resourceTableRowClassName = cn(
  'border-b border-border/60 transition-all duration-150',
  '[&>td]:py-2', // tighten row density vs. shadcn default py-3
  'hover:bg-muted/50 hover:shadow-[inset_3px_0_0_hsl(var(--primary)/0.3)]',
  'group cursor-pointer',
  'data-[selected]:bg-primary/5 data-[selected]:shadow-[inset_3px_0_0_hsl(var(--primary)/0.5)]',
  'focus-visible:bg-primary/5 focus-visible:shadow-[var(--focus-ring)]',
);

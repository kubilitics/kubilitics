import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Standard motion config for list row entrance (staggered, subtle y + opacity). */
export const ROW_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: (index: number) => ({ delay: index * 0.03, duration: 0.2 }),
};

/**
 * Class names for data rows so the table feels like "card strips":
 * soft border, padding, hover lift, transition. Use with <tr> or motion.tr.
 */
export const resourceTableRowClassName = cn(
  'border-b border-border/60 transition-all duration-200',
  'hover:bg-muted/40',
  'group cursor-pointer',
  'data-[selected]:bg-primary/5'
);

export interface ResourceTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Use motion.tr for staggered entrance. */
  asMotion?: boolean;
  /** Row index for stagger delay when asMotion is true. */
  motionIndex?: number;
  /** Extra class for first/last row rounding (e.g. first:rounded-t-lg). Applied by parent when needed. */
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * Table row with consistent "card strip" styling and optional motion.
 * Use inside <tbody>; pair with table container that has rounded-xl overflow-hidden.
 */
export const ResourceTableRow = forwardRef<HTMLTableRowElement, ResourceTableRowProps>(
  ({ asMotion, motionIndex = 0, isFirst, isLast, className, children, ...props }, ref) => {
    const classes = cn(
      resourceTableRowClassName,
      isFirst && 'rounded-t-lg',
      isLast && 'rounded-b-lg',
      className
    );

    if (asMotion) {
      return (
        <motion.tr
          ref={ref}
          initial={ROW_MOTION.initial}
          animate={ROW_MOTION.animate}
          transition={ROW_MOTION.transition(motionIndex)}
          className={classes}
          {...props}
        >
          {children}
        </motion.tr>
      );
    }

    return (
      <tr ref={ref} className={classes} {...props}>
        {children}
      </tr>
    );
  }
);
ResourceTableRow.displayName = 'ResourceTableRow';

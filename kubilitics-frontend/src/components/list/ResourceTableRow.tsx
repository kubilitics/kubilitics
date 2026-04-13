import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import {
  resourceTableRowClassName,
  rowEntranceClass,
  rowEntranceStyle,
} from './resourceTableRowStyles';

export interface ResourceTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** @deprecated motion.tr is no longer used — CSS animations handle entrance. */
  asMotion?: boolean;
  /** Row index for stagger delay. */
  motionIndex?: number;
  isFirst?: boolean;
  isLast?: boolean;
  /** Whether the row is selected (for aria-selected) */
  isSelected?: boolean;
}

/**
 * Table row with consistent "card strip" styling and CSS entrance animation.
 * Uses CSS @keyframes instead of Framer Motion for 10x better performance.
 *
 * Non-component helpers and class constants live in ./resourceTableRowStyles.ts
 * so React Fast Refresh can hot-update this file without full page reload.
 */
export const ResourceTableRow = forwardRef<HTMLTableRowElement, ResourceTableRowProps>(
  ({ asMotion, motionIndex = 0, isFirst, isLast, isSelected, className, children, style, ...props }, ref) => {
    void asMotion;
    const classes = cn(
      resourceTableRowClassName,
      rowEntranceClass,
      isFirst && 'rounded-t-lg',
      isLast && 'rounded-b-lg',
      className,
    );

    return (
      <tr
        ref={ref}
        role="row"
        aria-selected={isSelected}
        className={classes}
        style={{ ...style, ...rowEntranceStyle(motionIndex) }}
        {...props}
      >
        {children}
      </tr>
    );
  },
);
ResourceTableRow.displayName = 'ResourceTableRow';

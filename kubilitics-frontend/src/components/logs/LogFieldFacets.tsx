/**
 * LogFieldFacets — sidebar panel showing auto-detected fields with value distributions.
 * Each value is clickable to add as a filter.
 */
import { useState, memo } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldInfo } from '@/hooks/useLogParser';

/* ─── Props ───────────────────────────────────────────────────────────────── */

export interface LogFieldFacetsProps {
  fields: FieldInfo[];
  activeFilters: Record<string, string>;
  onFilterAdd: (field: string, value: string) => void;
  onFilterRemove: (field: string) => void;
}

/* ─── Field Section ───────────────────────────────────────────────────────── */

interface FieldSectionProps {
  field: FieldInfo;
  isActive: boolean;
  activeValue?: string;
  onFilterAdd: (field: string, value: string) => void;
  onFilterRemove: (field: string) => void;
  maxCount: number;
}

const FieldSection = memo(function FieldSection({
  field,
  isActive,
  activeValue,
  onFilterAdd,
  onFilterRemove,
  maxCount,
}: FieldSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-[12px] font-medium text-foreground truncate flex-1">
          {field.name}
        </span>
        {isActive && (
          <button
            className="shrink-0 p-0.5 rounded hover:bg-destructive/20 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onFilterRemove(field.name);
            }}
            title="Remove filter"
          >
            <X className="h-3 w-3 text-destructive" />
          </button>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {field.uniqueValues}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-0.5">
          {field.topValues.map(({ value, count }) => {
            const barWidth = maxCount > 0 ? Math.max(8, (count / maxCount) * 100) : 0;
            const isSelected = isActive && activeValue === value;

            return (
              <button
                key={value}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors text-[11px]',
                  isSelected
                    ? 'bg-primary/15 text-primary'
                    : 'hover:bg-muted/50 text-foreground/80',
                )}
                onClick={() => {
                  if (isSelected) {
                    onFilterRemove(field.name);
                  } else {
                    onFilterAdd(field.name, value);
                  }
                }}
                title={`${field.name}=${value} (${count})`}
              >
                <span className="truncate flex-1 font-mono min-w-0">{value}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground text-[10px] w-8 text-right">
                  {count}
                </span>
                <div className="shrink-0 w-16 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      isSelected ? 'bg-primary' : 'bg-foreground/20',
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

/* ─── Main Component ──────────────────────────────────────────────────────── */

const DEFAULT_VISIBLE = 6;

export const LogFieldFacets = memo(function LogFieldFacets({
  fields,
  activeFilters,
  onFilterAdd,
  onFilterRemove,
}: LogFieldFacetsProps) {
  const [showAll, setShowAll] = useState(false);

  if (fields.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground/50">
        No structured fields detected
      </div>
    );
  }

  // Global max count for bar sizing
  const maxCount = Math.max(...fields.flatMap((f) => f.topValues.map((v) => v.count)));

  const visibleFields = showAll ? fields : fields.slice(0, DEFAULT_VISIBLE);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border/30">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Detected Fields
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleFields.map((field) => (
          <FieldSection
            key={field.name}
            field={field}
            isActive={field.name in activeFilters}
            activeValue={activeFilters[field.name]}
            onFilterAdd={onFilterAdd}
            onFilterRemove={onFilterRemove}
            maxCount={maxCount}
          />
        ))}

        {!showAll && fields.length > DEFAULT_VISIBLE && (
          <button
            className="w-full px-3 py-2 text-[11px] text-primary hover:text-primary/80 transition-colors text-center"
            onClick={() => setShowAll(true)}
          >
            Show all fields ({fields.length - DEFAULT_VISIBLE} more)
          </button>
        )}
      </div>
    </div>
  );
});

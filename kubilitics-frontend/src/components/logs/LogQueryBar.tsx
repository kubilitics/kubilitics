/**
 * LogQueryBar — structured search input with field-aware autocomplete and active filter badges.
 */
import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FieldInfo } from '@/hooks/useLogParser';

/* ─── Props ───────────────────────────────────────────────────────────────── */

export interface LogQueryBarProps {
  detectedFields: FieldInfo[];
  activeFilters: Record<string, string>;
  onFilterAdd: (field: string, value: string) => void;
  onFilterRemove: (field: string) => void;
  onClearAll: () => void;
  /** Optional plain-text search passthrough */
  textQuery?: string;
  onTextQueryChange?: (query: string) => void;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export const LogQueryBar = memo(function LogQueryBar({
  detectedFields,
  activeFilters,
  onFilterAdd,
  onFilterRemove,
  onClearAll,
  textQuery = '',
  onTextQueryChange,
}: LogQueryBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [phase, setPhase] = useState<'field' | 'value'>('field');
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filterCount = Object.keys(activeFilters).length;

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Suggestions based on phase
  const suggestions = (() => {
    if (phase === 'field') {
      const query = inputValue.toLowerCase();
      return detectedFields
        .filter((f) => !query || f.name.toLowerCase().includes(query))
        .slice(0, 10)
        .map((f) => ({ label: f.name, sublabel: `${f.uniqueValues} values` }));
    }
    if (phase === 'value' && selectedField) {
      const field = detectedFields.find((f) => f.name === selectedField);
      if (!field) return [];
      const query = inputValue.toLowerCase();
      return field.topValues
        .filter((v) => !query || v.value.toLowerCase().includes(query))
        .map((v) => ({ label: v.value, sublabel: `${v.count}` }));
    }
    return [];
  })();

  const handleSelectField = useCallback((fieldName: string) => {
    setSelectedField(fieldName);
    setPhase('value');
    setInputValue('');
    setShowSuggestions(true);
    inputRef.current?.focus();
  }, []);

  const handleSelectValue = useCallback(
    (value: string) => {
      if (selectedField) {
        onFilterAdd(selectedField, value);
      }
      setSelectedField(null);
      setPhase('field');
      setInputValue('');
      setShowSuggestions(false);
    },
    [selectedField, onFilterAdd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (phase === 'field' && inputValue.trim()) {
          // Check if it's a known field name
          const match = detectedFields.find(
            (f) => f.name.toLowerCase() === inputValue.toLowerCase(),
          );
          if (match) {
            handleSelectField(match.name);
          } else if (onTextQueryChange) {
            // Fall through as text search
            onTextQueryChange(inputValue.trim());
            setInputValue('');
            setShowSuggestions(false);
          }
        } else if (phase === 'value' && inputValue.trim() && selectedField) {
          handleSelectValue(inputValue.trim());
        }
      } else if (e.key === 'Escape') {
        if (phase === 'value') {
          setPhase('field');
          setSelectedField(null);
          setInputValue('');
        } else {
          setShowSuggestions(false);
        }
      } else if (e.key === 'Backspace' && !inputValue && phase === 'value') {
        setPhase('field');
        setSelectedField(null);
      }
    },
    [phase, inputValue, selectedField, detectedFields, onTextQueryChange, handleSelectField, handleSelectValue],
  );

  const placeholder =
    phase === 'field'
      ? 'Type field name to filter...'
      : `Value for ${selectedField}...`;

  return (
    <div ref={containerRef} className="relative">
      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground/50" />

        {/* Selected field indicator */}
        {selectedField && (
          <Badge className="shrink-0 text-[10px] bg-primary/15 text-primary border border-primary/30 px-2 py-0 h-5 gap-1">
            {selectedField} =
          </Badge>
        )}

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[12px] font-mono outline-none placeholder:text-muted-foreground/40 text-foreground"
        />

        {/* Text query display */}
        {textQuery && (
          <Badge className="shrink-0 text-[10px] bg-muted text-foreground/70 border border-border/30 px-2 py-0 h-5 gap-1">
            &quot;{textQuery}&quot;
            <button onClick={() => onTextQueryChange?.('')} className="hover:text-foreground">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        )}

        {filterCount > 0 && (
          <button
            onClick={onClearAll}
            className="shrink-0 text-[11px] text-destructive/70 hover:text-destructive transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Active filter badges */}
      {filterCount > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/20 flex-wrap">
          {Object.entries(activeFilters).map(([field, value]) => (
            <Badge
              key={field}
              className="text-[10px] bg-primary/10 text-primary border border-primary/25 px-2 py-0 h-5 gap-1 font-mono"
            >
              {field}={value}
              <button
                onClick={() => onFilterRemove(field)}
                className="hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Suggestion dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-0.5 rounded-lg border border-border bg-popover shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s.label}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[12px] hover:bg-muted/60 transition-colors text-left"
              onClick={() => {
                if (phase === 'field') handleSelectField(s.label);
                else handleSelectValue(s.label);
              }}
            >
              <span className="font-mono text-foreground truncate">{s.label}</span>
              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{s.sublabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

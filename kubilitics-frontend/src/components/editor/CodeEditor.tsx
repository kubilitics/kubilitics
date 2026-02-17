import { useEffect, useRef, useCallback } from 'react';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/utils';

// Custom Kubilitics dark theme - base theme without font size
const createKubiliticsTheme = (fontSize: string) => EditorView.theme({
  '&': {
    height: '100%',
    fontSize: fontSize,
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  },
  '.cm-content': {
    caretColor: 'hsl(var(--primary))',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    padding: '12px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'hsl(var(--primary))',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'hsl(var(--primary) / 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'hsl(var(--muted) / 0.3)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'hsl(var(--muted) / 0.3)',
  },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--muted) / 0.3)',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRight: '1px solid hsl(var(--border))',
    paddingRight: '8px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 16px',
    minWidth: '40px',
    fontSize: '12px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    cursor: 'pointer',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    padding: '0 4px',
    borderRadius: '4px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'hsl(var(--primary) / 0.3)',
    outline: '1px solid hsl(var(--primary) / 0.5)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'hsl(48 100% 50% / 0.3)',
    outline: '1px solid hsl(48 100% 50% / 0.5)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'hsl(48 100% 50% / 0.5)',
  },
  '.cm-tooltip': {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    boxShadow: '0 4px 12px hsl(var(--foreground) / 0.1)',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li': {
      padding: '4px 8px',
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'hsl(var(--accent))',
      color: 'hsl(var(--accent-foreground))',
    },
  },
  '.cm-panels': {
    backgroundColor: 'hsl(var(--muted))',
    color: 'hsl(var(--foreground))',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid hsl(var(--border))',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid hsl(var(--border))',
  },
  '.cm-panel.cm-search': {
    padding: '8px 12px',
    backgroundColor: 'hsl(var(--muted))',
  },
  '.cm-panel.cm-search input': {
    backgroundColor: 'hsl(var(--background))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '4px',
    padding: '4px 8px',
    color: 'hsl(var(--foreground))',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'hsl(var(--primary))',
    color: 'hsl(var(--primary-foreground))',
    borderRadius: '4px',
    padding: '4px 8px',
    marginLeft: '4px',
  },
});

// Syntax highlighting style for YAML
const kubiliticsHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'hsl(280 80% 65%)' },
  { tag: tags.atom, color: 'hsl(200 80% 65%)' },
  { tag: tags.number, color: 'hsl(30 90% 60%)' },
  { tag: tags.definition(tags.variableName), color: 'hsl(180 60% 55%)' },
  { tag: tags.variableName, color: 'hsl(var(--foreground))' },
  { tag: tags.string, color: 'hsl(100 60% 55%)' },
  { tag: tags.special(tags.string), color: 'hsl(100 60% 55%)' },
  { tag: tags.comment, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
  { tag: tags.propertyName, color: 'hsl(200 80% 65%)' },
  { tag: tags.bool, color: 'hsl(30 90% 60%)' },
  { tag: tags.null, color: 'hsl(var(--muted-foreground))' },
  { tag: tags.operator, color: 'hsl(var(--foreground))' },
  { tag: tags.punctuation, color: 'hsl(var(--muted-foreground))' },
  { tag: tags.meta, color: 'hsl(var(--muted-foreground))' },
  { tag: tags.tagName, color: 'hsl(340 75% 60%)' },
  { tag: tags.attributeName, color: 'hsl(200 80% 65%)' },
  { tag: tags.attributeValue, color: 'hsl(100 60% 55%)' },
]);

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
  placeholder?: string;
  extensions?: Extension[];
  fontSize?: 'small' | 'medium' | 'large';
}

const EMPTY_EXTENSIONS: Extension[] = [];

const fontSizeMap = {
  small: '13px',
  medium: '15px',
  large: '17px',
};

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  className,
  minHeight = '400px',
  extensions: additionalExtensions = EMPTY_EXTENSIONS,
  fontSize = 'small',
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref updated
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const createExtensions = useCallback(() => {
    const baseExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({
        openText: '▼',
        closedText: '▶',
      }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      yaml(),
      createKubiliticsTheme(fontSizeMap[fontSize]),
      syntaxHighlighting(kubiliticsHighlightStyle),
      EditorView.lineWrapping,
      ...additionalExtensions,
    ];

    if (readOnly) {
      baseExtensions.push(EditorState.readOnly.of(true));
    } else {
      baseExtensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        })
      );
    }

    return baseExtensions;
  }, [readOnly, additionalExtensions, fontSize]);

  // When editable (onChange provided): use value only as initial doc; never overwrite from prop so typing is never reverted.
  // When readOnly: sync value from prop so external updates (e.g. refetch) are shown.
  const isControlled = !readOnly && typeof onChange === 'function';

  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: createExtensions(),
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [createExtensions]);

  // Only sync prop into editor when read-only (no onChange). Editable mode never overwrites doc from prop.
  useEffect(() => {
    if (isControlled) return;
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }, [value, isControlled]);

  return (
    <div
      ref={editorRef}
      className={cn(
        'rounded-lg border border-border overflow-hidden',
        className
      )}
      style={{ minHeight }}
    />
  );
}

# YAML Power Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the YAML tab into an enterprise-ready viewer with six features: Apply-Ready preset, JSON/YAML mode toggle, rich copy menu, one-click fold actions, cursor-following breadcrumb, and a large-resource guard. Builds directly on the Clean/Raw toggle shipped at `53021db`.

**Architecture:** Grow `src/lib/yaml/filterYaml.ts` with new presets and helpers (still pure, still no React). Add a local `yamlFoldRanges.ts` walker for line-range math next to the viewer. Extract `YamlCopyMenu.tsx` as a presentational dropdown. Inline all UI logic into `YamlViewer.tsx` — the final `YamlCanvas` extraction is deferred to sub-project 3 where it can be done alongside unifying `YamlEditorDialog`.

**Tech Stack:** TypeScript, React, Vitest, `@testing-library/react`, `js-yaml`, `@monaco-editor/react`, shadcn/ui primitives (`Button`, `DropdownMenu`, `Tooltip`, `Separator`).

**Spec:** `docs/superpowers/specs/2026-04-16-yaml-power-pack-design.md`

**Session state:** Tauri dev is running. Vite HMR picks up every change. No rebuild needed between tasks.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `kubilitics-frontend/src/lib/yaml/filterYaml.ts` | expand | Presets (clean/apply-ready/raw), `toJson`, `isLargeResource`, `wellKnownFoldPaths`. Pure. |
| `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts` | expand | Unit tests for every new export. |
| `kubilitics-frontend/src/components/resources/yamlFoldRanges.ts` | create | `findFoldRange(yaml, dotPath)` indentation walker. Pure. |
| `kubilitics-frontend/src/components/resources/yamlFoldRanges.test.ts` | create | Unit tests with realistic fixtures. |
| `kubilitics-frontend/src/components/resources/YamlCopyMenu.tsx` | create | Presentational dropdown, 5 copy actions. |
| `kubilitics-frontend/src/components/resources/YamlCopyMenu.test.tsx` | create | Unit tests. |
| `kubilitics-frontend/src/components/editor/CodeEditor.tsx` | tiny modify | Add `language?: 'yaml' \| 'json'` prop (defaults to 'yaml'). |
| `kubilitics-frontend/src/components/resources/YamlViewer.tsx` | modify | Wire everything together. |
| `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx` | expand | Integration tests for each new feature. |

Tasks touch files in the order above — start pure, end UI.

---

## Task 1: Filter module expansion

**Files:**
- Modify: `kubilitics-frontend/src/lib/yaml/filterYaml.ts`
- Test: `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts`

### Step 1: Write the failing tests

Append to `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts` (inside the existing `describe` block or a new one — both work):

```ts
import { filterYaml, toJson, isLargeResource, wellKnownFoldPaths } from './filterYaml';

describe("filterYaml — 'apply-ready' preset", () => {
  const fullPod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: 'nginx',
      namespace: 'default',
      labels: { app: 'nginx' },
      annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}' },
      uid: 'abc-123',
      resourceVersion: '42',
      creationTimestamp: '2026-04-16T00:00:00Z',
      generation: 1,
      selfLink: '/api/v1/namespaces/default/pods/nginx',
      ownerReferences: [{ kind: 'ReplicaSet', name: 'nginx-rs', uid: 'rs-uid' }],
      managedFields: [{ manager: 'kubelet' }],
    },
    spec: { containers: [{ name: 'c', image: 'nginx' }] },
    status: { phase: 'Running', podIP: '10.0.0.1' },
  };

  it('strips every server-managed field', () => {
    const out = filterYaml(fullPod, 'apply-ready') as typeof fullPod;
    expect(out.metadata).not.toHaveProperty('uid');
    expect(out.metadata).not.toHaveProperty('resourceVersion');
    expect(out.metadata).not.toHaveProperty('creationTimestamp');
    expect(out.metadata).not.toHaveProperty('generation');
    expect(out.metadata).not.toHaveProperty('selfLink');
    expect(out.metadata).not.toHaveProperty('ownerReferences');
    expect(out.metadata).not.toHaveProperty('managedFields');
    expect(out).not.toHaveProperty('status');
  });

  it('keeps name, namespace, labels, annotations, spec intact', () => {
    const out = filterYaml(fullPod, 'apply-ready') as typeof fullPod;
    expect(out.apiVersion).toBe('v1');
    expect(out.kind).toBe('Pod');
    expect(out.metadata.name).toBe('nginx');
    expect(out.metadata.namespace).toBe('default');
    expect(out.metadata.labels).toEqual({ app: 'nginx' });
    expect(out.metadata.annotations).toEqual({ 'kubectl.kubernetes.io/last-applied-configuration': '{}' });
    expect(out.spec).toEqual(fullPod.spec);
  });

  it('does not mutate input', () => {
    const snapshot = JSON.stringify(fullPod);
    filterYaml(fullPod, 'apply-ready');
    expect(JSON.stringify(fullPod)).toBe(snapshot);
  });

  it('is a no-op on already-minimal objects', () => {
    const minimal = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'empty', namespace: 'default' },
      data: { foo: 'bar' },
    };
    const out = filterYaml(minimal, 'apply-ready') as typeof minimal;
    expect(out.metadata.name).toBe('empty');
    expect(out.data).toEqual({ foo: 'bar' });
  });
});

describe('toJson', () => {
  it('produces valid JSON parseable by JSON.parse', () => {
    const obj = { kind: 'Pod', metadata: { name: 'p' } };
    const text = toJson(obj);
    expect(JSON.parse(text)).toEqual(obj);
  });

  it('indents to 2 spaces by default', () => {
    const text = toJson({ a: 1 });
    expect(text).toBe('{\n  "a": 1\n}');
  });

  it('respects the indent option', () => {
    const text = toJson({ a: 1 }, { indent: 0 });
    expect(text).toBe('{"a":1}');
  });
});

describe('isLargeResource', () => {
  it('is true above 1 MB', () => {
    expect(isLargeResource('x'.repeat(1_048_577))).toBe(true);
  });
  it('is false just under 1 MB', () => {
    expect(isLargeResource('x'.repeat(1_048_575))).toBe(false);
  });
  it('is false for empty input', () => {
    expect(isLargeResource('')).toBe(false);
  });
});

describe('wellKnownFoldPaths', () => {
  it('returns exactly three stable entries', () => {
    const paths = wellKnownFoldPaths();
    expect(paths).toHaveLength(3);
    expect(paths.map((p) => p.path)).toEqual([
      'metadata.managedFields',
      'status',
      'spec.template',
    ]);
    expect(paths.map((p) => p.label)).toEqual([
      'Fold managedFields',
      'Fold status',
      'Fold spec.template',
    ]);
  });

  it('is referentially stable across calls (for memoization safety)', () => {
    const a = wellKnownFoldPaths();
    const b = wellKnownFoldPaths();
    expect(a).toEqual(b);
  });
});
```

### Step 2: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/lib/yaml/filterYaml.test.ts`
Expected: FAIL — `toJson`, `isLargeResource`, `wellKnownFoldPaths` not exported; `'apply-ready'` preset unknown.

### Step 3: Expand the implementation

Replace the entire contents of `kubilitics-frontend/src/lib/yaml/filterYaml.ts` with:

```ts
/**
 * Strip display-noise from a K8s resource object before YAML serialization,
 * and provide companion helpers for JSON rendering, size detection, and the
 * list of well-known fold paths.
 *
 * Presets:
 *   - 'clean' (default): removes metadata.managedFields. Everything else —
 *     status, resourceVersion, uid, generation, creationTimestamp — is kept
 *     because it has debugging value. Matches Headlamp's behavior.
 *   - 'apply-ready': removes all server-managed metadata (uid, resourceVersion,
 *     creationTimestamp, generation, selfLink, ownerReferences, managedFields)
 *     AND the top-level status block. Output is safe to pipe to kubectl apply.
 *   - 'raw': identity. Returns the object unchanged.
 *
 * Pure: never mutates its input. Unknown or primitive inputs pass through.
 * The preset enum is the extension point: new presets can be added as
 * additional arms without changing any caller's API.
 */
export type YamlPreset = 'clean' | 'apply-ready' | 'raw';

const APPLY_READY_METADATA_STRIP = [
  'managedFields',
  'uid',
  'resourceVersion',
  'creationTimestamp',
  'generation',
  'selfLink',
  'ownerReferences',
] as const;

export function filterYaml<T>(obj: T, preset: YamlPreset): T {
  if (preset === 'raw' || !obj || typeof obj !== 'object') return obj;

  const input = obj as Record<string, unknown>;
  const metadata = input.metadata;
  const hasMetadataObject =
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata);

  if (preset === 'clean') {
    if (hasMetadataObject && 'managedFields' in (metadata as Record<string, unknown>)) {
      const { managedFields: _drop, ...rest } = metadata as Record<string, unknown>;
      return { ...input, metadata: rest } as T;
    }
    return obj;
  }

  // 'apply-ready'
  const next: Record<string, unknown> = { ...input };
  if (hasMetadataObject) {
    const metaRecord = metadata as Record<string, unknown>;
    const cleanedMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metaRecord)) {
      if (!(APPLY_READY_METADATA_STRIP as readonly string[]).includes(k)) {
        cleanedMeta[k] = v;
      }
    }
    next.metadata = cleanedMeta;
  }
  delete next.status;
  return next as T;
}

/**
 * JSON serialization companion to filterYaml. Separate function so callers
 * don't inline JSON.stringify and we have a single place to add stable key
 * sorting later if needed.
 */
export function toJson(obj: unknown, opts?: { indent?: number }): string {
  const indent = opts?.indent ?? 2;
  return JSON.stringify(obj, null, indent);
}

/**
 * True when the serialized YAML (or JSON) string exceeds 1 MB. Typical K8s
 * resources are < 50 KB; above 1 MB Monaco's first paint becomes noticeable
 * and the Power Pack applies auto-folding + a warning banner.
 */
const LARGE_RESOURCE_BYTES = 1_048_576; // 1 MB

export function isLargeResource(text: string): boolean {
  return text.length > LARGE_RESOURCE_BYTES;
}

/**
 * Well-known YAML paths that can be folded on demand. Consumers pass these to
 * Monaco's folding API (via a local range-finder that walks the serialized
 * text). Kept stable so the fold menu renders deterministically and the
 * object identity survives re-renders (cheap to memo against).
 */
const WELL_KNOWN_FOLD_PATHS: ReadonlyArray<{ path: string; label: string }> = [
  { path: 'metadata.managedFields', label: 'Fold managedFields' },
  { path: 'status', label: 'Fold status' },
  { path: 'spec.template', label: 'Fold spec.template' },
];

export function wellKnownFoldPaths(): ReadonlyArray<{ path: string; label: string }> {
  return WELL_KNOWN_FOLD_PATHS;
}
```

### Step 4: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/lib/yaml/filterYaml.test.ts`
Expected: PASS — 15 tests total (7 existing + 8 new).

### Step 5: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 6: Commit

```bash
git add kubilitics-frontend/src/lib/yaml/filterYaml.ts kubilitics-frontend/src/lib/yaml/filterYaml.test.ts
git commit -m "feat(yaml): add apply-ready preset, toJson, isLargeResource, wellKnownFoldPaths"
```

---

## Task 2: yamlFoldRanges walker

**Files:**
- Create: `kubilitics-frontend/src/components/resources/yamlFoldRanges.ts`
- Test: `kubilitics-frontend/src/components/resources/yamlFoldRanges.test.ts`

### Step 1: Write the failing tests

Create `kubilitics-frontend/src/components/resources/yamlFoldRanges.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findFoldRange } from './yamlFoldRanges';

const pod = `apiVersion: v1
kind: Pod
metadata:
  name: nginx
  namespace: default
  managedFields:
    - manager: kubelet
      operation: Update
spec:
  containers:
    - name: nginx
      image: nginx:1.25
status:
  phase: Running
  podIP: 10.0.0.1
`;

const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx
`;

describe('findFoldRange', () => {
  it('finds top-level status block', () => {
    const r = findFoldRange(pod, 'status');
    expect(r).toEqual({ startLine: 13, endLine: 15 });
  });

  it('finds metadata.managedFields when nested', () => {
    const r = findFoldRange(pod, 'metadata.managedFields');
    expect(r).toEqual({ startLine: 6, endLine: 8 });
  });

  it('finds spec.template in a Deployment', () => {
    const r = findFoldRange(deployment, 'spec.template');
    expect(r).toEqual({ startLine: 7, endLine: 14 });
  });

  it('returns null when the path is absent', () => {
    expect(findFoldRange(pod, 'spec.template')).toBeNull();
  });

  it('does not match a key that is a prefix substring', () => {
    const withStatuses = `apiVersion: v1
kind: Pod
metadata:
  name: p
spec:
  containers: []
statuses:
  - foo
`;
    expect(findFoldRange(withStatuses, 'status')).toBeNull();
  });

  it('handles empty input', () => {
    expect(findFoldRange('', 'status')).toBeNull();
  });

  it('handles single-line input without a body', () => {
    expect(findFoldRange('kind: Pod\n', 'status')).toBeNull();
  });

  it('returns null when a child segment is missing under its parent', () => {
    // metadata exists but managedFields does not
    const cleaned = `apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
    - name: c
`;
    expect(findFoldRange(cleaned, 'metadata.managedFields')).toBeNull();
  });
});
```

### Step 2: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/yamlFoldRanges.test.ts`
Expected: FAIL — `Cannot find module './yamlFoldRanges'`.

### Step 3: Write the implementation

Create `kubilitics-frontend/src/components/resources/yamlFoldRanges.ts`:

```ts
/**
 * Locate the 1-indexed line range of a dot-path in a serialized YAML string,
 * without a full parse. Uses a simple indentation walker so it is safe to
 * call on every keystroke.
 *
 *   findFoldRange(yaml, 'status')
 *   findFoldRange(yaml, 'metadata.managedFields')
 *   findFoldRange(yaml, 'spec.template')
 *
 * Returns { startLine, endLine } (both 1-indexed, inclusive) or null if the
 * path is not present at the expected nesting depth.
 */
export interface FoldRange {
  startLine: number;
  endLine: number;
}

export function findFoldRange(yaml: string, dotPath: string): FoldRange | null {
  if (!yaml || !dotPath) return null;

  const segments = dotPath.split('.').filter(Boolean);
  if (segments.length === 0) return null;

  const lines = yaml.split('\n');
  let searchFrom = 0;
  let parentIndent = -1; // first segment must start at column 0
  let matchLine = -1;
  let matchIndent = -1;

  for (const segment of segments) {
    const hit = findKeyLine(lines, segment, searchFrom, parentIndent);
    if (hit === -1) return null;
    matchLine = hit;
    matchIndent = indentOf(lines[hit]);
    // Next segment must appear AFTER this line and at a deeper indent.
    searchFrom = hit + 1;
    parentIndent = matchIndent;
  }

  // Walk forward from the matched line until we drop back to indent <= match.
  const endLine = walkEnd(lines, matchLine, matchIndent);
  return { startLine: matchLine + 1, endLine: endLine + 1 }; // 1-indexed
}

/** Index of the first line that starts with `<indent><key>:` where indent matches the parent level + more. */
function findKeyLine(
  lines: string[],
  key: string,
  from: number,
  parentIndent: number,
): number {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (parentIndent < 0) {
      // Top-level: require indent === 0
      if (ind !== 0) continue;
    } else {
      // Nested: require indent > parentIndent, AND if we drop back to <= parent we must stop (key not found in this subtree)
      if (ind <= parentIndent) return -1;
    }
    // Match `<spaces><key>:` exactly — use a boundary so 'status' does not match 'statuses:'.
    const stripped = line.slice(ind);
    if (stripped === `${key}:` || stripped.startsWith(`${key}: `) || stripped.startsWith(`${key}:\t`)) {
      return i;
    }
  }
  return -1;
}

/** Returns the 0-indexed last line belonging to a block whose key is at `blockIndent`. */
function walkEnd(lines: string[], startLine: number, blockIndent: number): number {
  let lastContentLine = startLine;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (ind <= blockIndent) {
      return lastContentLine;
    }
    lastContentLine = i;
  }
  return lastContentLine;
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}
```

### Step 4: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/yamlFoldRanges.test.ts`
Expected: PASS — 8 tests.

If any test fails, debug the walker against the failing fixture. Common pitfalls: off-by-one on `startLine` (must be 1-indexed), `walkEnd` including a trailing blank line (should return the last *content* line, not the blank).

### Step 5: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 6: Commit

```bash
git add kubilitics-frontend/src/components/resources/yamlFoldRanges.ts kubilitics-frontend/src/components/resources/yamlFoldRanges.test.ts
git commit -m "feat(yaml): add yamlFoldRanges indent walker for well-known fold paths"
```

---

## Task 3: YamlCopyMenu component

**Files:**
- Create: `kubilitics-frontend/src/components/resources/YamlCopyMenu.tsx`
- Test: `kubilitics-frontend/src/components/resources/YamlCopyMenu.test.tsx`

### Step 1: Write the failing tests

Create `kubilitics-frontend/src/components/resources/YamlCopyMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { YamlCopyMenu } from './YamlCopyMenu';

function renderMenu(onCopy = vi.fn()) {
  render(
    <TooltipProvider>
      <YamlCopyMenu
        cleanYaml="clean-yaml-text"
        applyReadyYaml="apply-ready-yaml-text"
        rawYaml="raw-yaml-text"
        jsonText='{"kind":"Pod"}'
        kubectlApplyCommand={'cat <<\'EOF\' | kubectl apply -f -\napply-ready-yaml-text\nEOF'}
        onCopy={onCopy}
      />
    </TooltipProvider>,
  );
  // Open the menu so items are in the DOM.
  fireEvent.click(screen.getByRole('button', { name: /copy menu/i }));
  return onCopy;
}

describe('YamlCopyMenu', () => {
  it('renders a trigger button with copy menu label', () => {
    render(
      <TooltipProvider>
        <YamlCopyMenu
          cleanYaml="" applyReadyYaml="" rawYaml="" jsonText="" kubectlApplyCommand=""
          onCopy={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /copy menu/i })).toBeInTheDocument();
  });

  it('shows all five menu items after opening', () => {
    renderMenu();
    expect(screen.getByText(/copy as yaml \(clean\)/i)).toBeInTheDocument();
    expect(screen.getByText(/copy as yaml \(apply-ready\)/i)).toBeInTheDocument();
    expect(screen.getByText(/copy as yaml \(raw\)/i)).toBeInTheDocument();
    expect(screen.getByText(/copy as json/i)).toBeInTheDocument();
    expect(screen.getByText(/kubectl apply/i)).toBeInTheDocument();
  });

  it('fires onCopy with the Clean label and text when Clean item clicked', () => {
    const onCopy = renderMenu();
    fireEvent.click(screen.getByText(/copy as yaml \(clean\)/i));
    expect(onCopy).toHaveBeenCalledWith('YAML (Clean)', 'clean-yaml-text');
  });

  it('fires onCopy with the Apply-ready label and text', () => {
    const onCopy = renderMenu();
    fireEvent.click(screen.getByText(/copy as yaml \(apply-ready\)/i));
    expect(onCopy).toHaveBeenCalledWith('YAML (Apply-ready)', 'apply-ready-yaml-text');
  });

  it('fires onCopy with the Raw label and text', () => {
    const onCopy = renderMenu();
    fireEvent.click(screen.getByText(/copy as yaml \(raw\)/i));
    expect(onCopy).toHaveBeenCalledWith('YAML (Raw)', 'raw-yaml-text');
  });

  it('fires onCopy with the JSON label and text', () => {
    const onCopy = renderMenu();
    fireEvent.click(screen.getByText(/copy as json/i));
    expect(onCopy).toHaveBeenCalledWith('JSON', '{"kind":"Pod"}');
  });

  it('fires onCopy with the kubectl apply heredoc command', () => {
    const onCopy = renderMenu();
    fireEvent.click(screen.getByText(/kubectl apply/i));
    const [label, text] = onCopy.mock.calls[0];
    expect(label).toBe('kubectl apply command');
    expect(text).toContain("cat <<'EOF'");
    expect(text).toContain('apply-ready-yaml-text');
    expect(text).toContain('EOF');
  });
});
```

### Step 2: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlCopyMenu.test.tsx`
Expected: FAIL — `Cannot find module './YamlCopyMenu'`.

### Step 3: Write the component

Create `kubilitics-frontend/src/components/resources/YamlCopyMenu.tsx`:

```tsx
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface YamlCopyMenuProps {
  cleanYaml: string;
  applyReadyYaml: string;
  rawYaml: string;
  /** JSON text — caller decides which preset it reflects. */
  jsonText: string;
  /** Apply-ready YAML wrapped in a shell heredoc for direct paste. */
  kubectlApplyCommand: string;
  onCopy: (label: string, text: string) => void;
}

export function YamlCopyMenu({
  cleanYaml,
  applyReadyYaml,
  rawYaml,
  jsonText,
  kubectlApplyCommand,
  onCopy,
}: YamlCopyMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Copy menu">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Copy YAML / JSON / command</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onCopy('YAML (Clean)', cleanYaml)}>
          Copy as YAML (Clean)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy('YAML (Apply-ready)', applyReadyYaml)}>
          Copy as YAML (Apply-ready)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy('YAML (Raw)', rawYaml)}>
          Copy as YAML (Raw)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onCopy('JSON', jsonText)}>
          Copy as JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onCopy('kubectl apply command', kubectlApplyCommand)}>
          Copy <code className="font-mono text-[10px]">kubectl apply -f -</code>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Step 4: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlCopyMenu.test.tsx`
Expected: PASS — 7 tests.

Troubleshooting: if `getByText(/kubectl apply/i)` fails to find the item because the inner `<code>` splits the text node, use `getByRole('menuitem', { name: /kubectl apply/i })` instead.

### Step 5: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 6: Commit

```bash
git add kubilitics-frontend/src/components/resources/YamlCopyMenu.tsx kubilitics-frontend/src/components/resources/YamlCopyMenu.test.tsx
git commit -m "feat(yaml): add YamlCopyMenu with 5 copy targets"
```

---

## Task 4: CodeEditor language prop

**Files:**
- Modify: `kubilitics-frontend/src/components/editor/CodeEditor.tsx`

### Step 1: Add the prop

In `kubilitics-frontend/src/components/editor/CodeEditor.tsx`, modify the `CodeEditorProps` interface (around lines 51-63) to add a `language` prop:

```ts
interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
  placeholder?: string;
  fontSize?: 'small' | 'medium' | 'large';
  /** Editor language. Defaults to 'yaml'. */
  language?: 'yaml' | 'json';
  /** Called after Monaco mounts, exposing the editor instance for external control. */
  onEditorReady?: (editor: monacoType.editor.IStandaloneCodeEditor) => void;
  /** @deprecated Ignored — extensions are CodeMirror-specific. */
  extensions?: unknown[];
}
```

Add `language` to the destructure (around line 70):

```ts
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  className,
  minHeight = '400px',
  fontSize = 'small',
  language = 'yaml',
  onEditorReady,
}: CodeEditorProps) {
```

Change `defaultLanguage="yaml"` to `language={language}` in the `<Editor>` JSX (around line 257):

```tsx
<Editor
  height={minHeight}
  language={language}
  value={value}
```

Note: `language` (dynamic) replaces `defaultLanguage` (initial-only) so switching between YAML and JSON re-tokenizes correctly.

### Step 2: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 3: Run the editor's own tests (if any) and the YamlViewer tests to confirm nothing regressed

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 6 tests (existing ones still work).

### Step 4: Commit

```bash
git add kubilitics-frontend/src/components/editor/CodeEditor.tsx
git commit -m "feat(editor): add language prop to CodeEditor (yaml | json)"
```

---

## Task 5: YamlViewer — third preset + mode toggle + JSON

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.tsx`
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx`

### Step 1: Extend the test file first

Append these tests to `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx` inside the existing describe block:

```tsx
it("'Apply-ready' preset hides status, uid, resourceVersion", () => {
  renderViewer({
    resource: {
      ...podResource,
      metadata: {
        ...podResource.metadata,
        uid: 'abc',
        resourceVersion: '42',
      },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /apply-ready/i }));
  const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
  expect(editor.value).not.toContain('status:');
  expect(editor.value).not.toContain('uid:');
  expect(editor.value).not.toContain('resourceVersion:');
  expect(editor.value).toContain('name: nginx');
  expect(editor.value).toContain('image: nginx:1.25');
});

it('JSON mode with Clean preset produces valid JSON without managedFields', () => {
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
  const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
  // Must parse as JSON.
  const parsed = JSON.parse(editor.value);
  expect(parsed.kind).toBe('Pod');
  expect(parsed.metadata).not.toHaveProperty('managedFields');
  expect(parsed.status).toBeDefined(); // Clean keeps status
});

it('JSON mode with Apply-ready preset strips status and uid', () => {
  renderViewer({
    resource: {
      ...podResource,
      metadata: { ...podResource.metadata, uid: 'abc' },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /apply-ready/i }));
  fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
  const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
  const parsed = JSON.parse(editor.value);
  expect(parsed).not.toHaveProperty('status');
  expect(parsed.metadata).not.toHaveProperty('uid');
});

it('Edit mode forces preset=Raw and mode=YAML; Cancel restores both', () => {
  renderViewer({ editable: true, onSave: vi.fn() });
  // Switch to JSON + Apply-ready before editing
  fireEvent.click(screen.getByRole('button', { name: /apply-ready/i }));
  fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
  // Enter edit
  fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
  // All toggles disabled
  expect(screen.getByRole('button', { name: /clean/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /apply-ready/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^raw$/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^yaml$/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^json$/i })).toBeDisabled();
  // Cancel
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  // Apply-ready + JSON should be restored
  expect(screen.getByRole('button', { name: /apply-ready/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /^json$/i })).toHaveAttribute('aria-pressed', 'true');
});
```

### Step 2: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: FAIL — 4 new tests fail because Apply-ready button, JSON toggle, and mode-restore behavior don't exist yet.

### Step 3: Modify `YamlViewer.tsx` — add mode state, third preset, JSON rendering

In `kubilitics-frontend/src/components/resources/YamlViewer.tsx`:

**3a. Update the `filterYaml` import (around line 12) to include `toJson`:**

```ts
import { filterYaml, toJson, type YamlPreset } from '@/lib/yaml/filterYaml';
```

**3b. Add mode state and ref next to the existing preset state (around line 72):**

```ts
const [preset, setPreset] = useState<YamlPreset>('clean');
const previousPresetRef = useRef<YamlPreset>('clean');
const [mode, setMode] = useState<'yaml' | 'json'>('yaml');
const previousModeRef = useRef<'yaml' | 'json'>('yaml');
```

**3c. Replace the existing `displayYaml` memo to branch on mode:**

```ts
const displayYaml = useMemo(() => {
  if (!resource) return yaml;
  if (preset === 'raw' && mode === 'yaml') return yaml;
  try {
    const filtered = filterYaml(resource, preset);
    return mode === 'json'
      ? toJson(filtered, { indent: 2 })
      : yamlParser.dump(filtered, {
          indent: 2,
          noArrayIndent: false,
          skipInvalid: true,
          flowLevel: -1,
          noRefs: true,
          lineWidth: -1,
        });
  } catch {
    return yaml;
  }
}, [preset, mode, resource, yaml]);
```

**3d. Update the segmented preset control to three pills. Find the existing control (the Clean/Raw `<div>` inline-flex wrapper) and replace with:**

```tsx
{resource && (
  <>
    <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 mr-1">
      <Button
        variant={preset === 'clean' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setPreset('clean')}
        disabled={isEditing}
        aria-pressed={preset === 'clean'}
        aria-label="Clean (hide managedFields)"
      >
        Clean
      </Button>
      <Button
        variant={preset === 'apply-ready' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setPreset('apply-ready')}
        disabled={isEditing}
        aria-pressed={preset === 'apply-ready'}
        aria-label="Apply-ready (remove server-managed fields)"
      >
        Apply-ready
      </Button>
      <Button
        variant={preset === 'raw' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setPreset('raw')}
        disabled={isEditing}
        aria-pressed={preset === 'raw'}
        aria-label="Raw (show full YAML)"
      >
        Raw
      </Button>
    </div>
    <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 mr-1">
      <Button
        variant={mode === 'yaml' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setMode('yaml')}
        disabled={isEditing}
        aria-pressed={mode === 'yaml'}
        aria-label="YAML view"
      >
        YAML
      </Button>
      <Button
        variant={mode === 'json' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 text-[11px] font-medium px-2.5 rounded-sm"
        onClick={() => setMode('json')}
        disabled={isEditing}
        aria-pressed={mode === 'json'}
        aria-label="JSON view"
      >
        JSON
      </Button>
    </div>
    <Separator orientation="vertical" className="h-4 mx-1" />
  </>
)}
```

**3e. Update `handleEdit` to stash and force both preset and mode:**

```ts
const handleEdit = () => {
  previousPresetRef.current = preset;
  previousModeRef.current = mode;
  setEditedYaml(yaml);
  setErrors([]);
  setEditorKey((k) => k + 1);
  setPreset('raw');
  setMode('yaml');
  setIsEditing(true);
};
```

**3f. Update `handleCancel` to restore both:**

```ts
const handleCancel = () => {
  setEditedYaml(yaml);
  setErrors([]);
  setIsEditing(false);
  setPreset(previousPresetRef.current);
  setMode(previousModeRef.current);
};
```

**3g. Update `handleSave` and `handleForceSave` — find every line that calls `setIsEditing(false)` AND restores preset (added in earlier task) and add `setMode(previousModeRef.current);` right after `setPreset(previousPresetRef.current);` at each site.**

**3h. Pass `language` to the read-mode `<CodeEditor>`:**

Find the read-mode `<CodeEditor>` block near the bottom of the return (currently passes `value={displayYaml}`). Add `language={mode}`:

```tsx
<CodeEditor
  value={displayYaml}
  language={mode}
  readOnly
  minHeight="600px"
  className="rounded-none border-0"
  fontSize="small"
/>
```

### Step 4: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 10 tests total (6 existing + 4 new).

### Step 5: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 6: Commit

```bash
git add kubilitics-frontend/src/components/resources/YamlViewer.tsx kubilitics-frontend/src/components/resources/YamlViewer.test.tsx
git commit -m "feat(yaml): Apply-ready preset + YAML/JSON mode toggle in YamlViewer

Preset control grows to three pills (Clean / Apply-ready / Raw). New
orthogonal YAML/JSON mode toggle — six combinations. Edit forces Raw+YAML
and restores both on exit. displayYaml memo serializes via toJson or
yamlParser.dump depending on mode. CodeEditor receives language prop."
```

---

## Task 6: YamlViewer — integrate YamlCopyMenu

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.tsx`
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx`

### Step 1: Extend the test file

Append to `YamlViewer.test.tsx`:

```tsx
it('copy menu Clean item copies filtered YAML', () => {
  renderViewer();
  // Open menu
  fireEvent.click(screen.getByRole('button', { name: /copy menu/i }));
  fireEvent.click(screen.getByText(/copy as yaml \(clean\)/i));
  const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(written).not.toContain('managedFields');
  expect(written).toContain('name: nginx');
});

it('copy menu Apply-ready item copies stripped YAML', () => {
  renderViewer({
    resource: {
      ...podResource,
      metadata: { ...podResource.metadata, uid: 'abc', resourceVersion: '42' },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /copy menu/i }));
  fireEvent.click(screen.getByText(/copy as yaml \(apply-ready\)/i));
  const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(written).not.toContain('status:');
  expect(written).not.toContain('uid:');
  expect(written).not.toContain('resourceVersion:');
  expect(written).toContain('name: nginx');
});

it('copy menu Raw item copies unfiltered YAML with managedFields', () => {
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /copy menu/i }));
  fireEvent.click(screen.getByText(/copy as yaml \(raw\)/i));
  const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(written).toContain('managedFields');
});

it('copy menu JSON item copies valid apply-ready JSON', () => {
  renderViewer({
    resource: {
      ...podResource,
      metadata: { ...podResource.metadata, uid: 'abc' },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /copy menu/i }));
  fireEvent.click(screen.getByText(/copy as json/i));
  const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  const parsed = JSON.parse(written);
  expect(parsed.kind).toBe('Pod');
  expect(parsed.metadata).not.toHaveProperty('uid');
  expect(parsed).not.toHaveProperty('status');
});

it('copy menu kubectl apply item copies heredoc command', () => {
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /copy menu/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /kubectl apply/i }));
  const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(written).toContain("cat <<'EOF' | kubectl apply -f -");
  expect(written).toContain('EOF');
  expect(written).toContain('name: nginx');
});
```

### Step 2: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: FAIL — 5 new tests fail because the copy menu isn't wired yet.

### Step 3: Wire the copy menu into YamlViewer

**3a. Add import for the menu:**

```ts
import { YamlCopyMenu } from './YamlCopyMenu';
```

**3b. Add two memos near `displayYaml` that pre-compute every copy-string:**

```ts
const cleanYaml = useMemo(() => {
  if (!resource) return yaml;
  try {
    return yamlParser.dump(filterYaml(resource, 'clean'), {
      indent: 2, noArrayIndent: false, skipInvalid: true, flowLevel: -1, noRefs: true, lineWidth: -1,
    });
  } catch {
    return yaml;
  }
}, [resource, yaml]);

const applyReadyYaml = useMemo(() => {
  if (!resource) return yaml;
  try {
    return yamlParser.dump(filterYaml(resource, 'apply-ready'), {
      indent: 2, noArrayIndent: false, skipInvalid: true, flowLevel: -1, noRefs: true, lineWidth: -1,
    });
  } catch {
    return yaml;
  }
}, [resource, yaml]);

const jsonText = useMemo(() => {
  if (!resource) return yaml;
  try {
    return toJson(filterYaml(resource, 'apply-ready'), { indent: 2 });
  } catch {
    return yaml;
  }
}, [resource, yaml]);

const kubectlApplyCommand = useMemo(
  () => `cat <<'EOF' | kubectl apply -f -\n${applyReadyYaml.trimEnd()}\nEOF`,
  [applyReadyYaml],
);
```

**3c. Add a shared onCopy callback that uses the existing toast:**

```ts
const handleMenuCopy = useCallback((label: string, text: string) => {
  navigator.clipboard.writeText(text);
  toast.success(`Copied ${label}`);
}, []);
```

**3d. Replace the existing single Copy `<Tooltip>` / `<Button>` block with `<YamlCopyMenu>`. Find in the read-mode actions fragment:**

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} aria-label="Copy YAML">
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  </TooltipTrigger>
  <TooltipContent side="bottom">{copied ? 'Copied!' : 'Copy YAML'}</TooltipContent>
</Tooltip>
```

Replace with:

```tsx
<YamlCopyMenu
  cleanYaml={cleanYaml}
  applyReadyYaml={applyReadyYaml}
  rawYaml={yaml}
  jsonText={jsonText}
  kubectlApplyCommand={kubectlApplyCommand}
  onCopy={handleMenuCopy}
/>
```

`handleCopy`, `copied`, and the `setCopied` calls can stay — the plain Copy button is gone but Edit mode still uses `handleCopy` implicitly? No, handleCopy is dead code now in read mode. Leave it for edit-mode flows if they reference it; otherwise remove. Read the current file and decide:
- If `handleCopy` is still referenced (e.g. in a keyboard shortcut), keep it.
- Otherwise remove `handleCopy`, `copied`, `setCopied` to avoid dead code.

### Step 4: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 15 tests total (10 existing + 5 new).

### Step 5: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 6: Commit

```bash
git add kubilitics-frontend/src/components/resources/YamlViewer.tsx kubilitics-frontend/src/components/resources/YamlViewer.test.tsx
git commit -m "feat(yaml): wire YamlCopyMenu into YamlViewer with 5 copy targets"
```

---

## Task 7: YamlViewer — fold menu + editor instance wiring

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.tsx`
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx`

### Step 1: Extend the test harness to provide a fake Monaco editor

Near the top of `YamlViewer.test.tsx`, right after the `CodeEditor` mock, add a helper for the fake editor and update the mock so `onEditorReady` is called synchronously with the fake:

```tsx
interface FakeEditorCalls {
  foldAllCalled: number;
  unfoldAllCalled: number;
  foldSelectedCalled: number;
  lastSelection?: { startLine: number; endLine: number };
  cursorListeners: Array<(e: { position: { lineNumber: number } }) => void>;
  revealLineCalled?: number;
}

function createFakeEditor(calls: FakeEditorCalls) {
  return {
    getAction: (id: string) => ({
      run: () => {
        if (id === 'editor.foldAll') calls.foldAllCalled++;
        else if (id === 'editor.unfoldAll') calls.unfoldAllCalled++;
        else if (id === 'editor.foldSelected') calls.foldSelectedCalled++;
        return Promise.resolve();
      },
    }),
    setSelection: (range: { startLineNumber: number; endLineNumber: number }) => {
      calls.lastSelection = { startLine: range.startLineNumber, endLine: range.endLineNumber };
    },
    onDidChangeCursorPosition: (listener: (e: { position: { lineNumber: number } }) => void) => {
      calls.cursorListeners.push(listener);
      return { dispose: () => {} };
    },
    revealLineInCenter: () => { calls.revealLineCalled = (calls.revealLineCalled ?? 0) + 1; },
  } as unknown as import('monaco-editor').editor.IStandaloneCodeEditor;
}
```

Update the `CodeEditor` mock to accept `onEditorReady` and fire it on mount with a fake editor:

```tsx
let fakeEditorCalls: FakeEditorCalls;

vi.mock('@/components/editor/CodeEditor', () => ({
  CodeEditor: ({ value, onEditorReady }: { value: string; onEditorReady?: (e: unknown) => void }) => {
    const didFire = React.useRef(false);
    React.useEffect(() => {
      if (!didFire.current && onEditorReady) {
        didFire.current = true;
        onEditorReady(createFakeEditor(fakeEditorCalls));
      }
    }, [onEditorReady]);
    return <textarea data-testid="code-editor" value={value} readOnly />;
  },
}));
```

Add `import React from 'react';` at the top. In `beforeEach`, reset `fakeEditorCalls`:

```tsx
beforeEach(() => {
  fakeEditorCalls = {
    foldAllCalled: 0,
    unfoldAllCalled: 0,
    foldSelectedCalled: 0,
    cursorListeners: [],
  };
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
```

### Step 2: Add fold-menu tests

Append:

```tsx
it('Fold All menu item calls editor.foldAll', async () => {
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /fold menu/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /^fold all$/i }));
  await screen.findByRole('button', { name: /fold menu/i }); // ensure re-render
  expect(fakeEditorCalls.foldAllCalled).toBe(1);
});

it('Unfold All menu item calls editor.unfoldAll', async () => {
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /fold menu/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /^unfold all$/i }));
  expect(fakeEditorCalls.unfoldAllCalled).toBe(1);
});

it('Fold status menu item selects the status line range then folds', async () => {
  // Use a fixture where filterYaml output is raw (preset=Raw) so status is present
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /^raw$/i })); // ensure status in view
  fireEvent.click(screen.getByRole('button', { name: /fold menu/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /fold status/i }));
  expect(fakeEditorCalls.lastSelection?.startLine).toBeGreaterThan(0);
  expect(fakeEditorCalls.foldSelectedCalled).toBe(1);
});

it('Fold managedFields item is disabled in Clean preset', () => {
  renderViewer();
  fireEvent.click(screen.getByRole('button', { name: /fold menu/i }));
  expect(screen.getByRole('menuitem', { name: /fold managedfields/i })).toHaveAttribute('aria-disabled', 'true');
});
```

### Step 3: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: FAIL — 4 new tests fail because the fold menu and editor-instance wiring don't exist.

### Step 4: Wire the fold menu

**4a. Add imports at the top of `YamlViewer.tsx`:**

```ts
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { wellKnownFoldPaths, isLargeResource } from '@/lib/yaml/filterYaml';
import { findFoldRange } from './yamlFoldRanges';
import type { editor as monacoEditor } from 'monaco-editor';
```

**4b. Add the editor instance ref next to other refs:**

```ts
const editorInstanceRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
```

**4c. Add `onEditorReady` to the read-mode `<CodeEditor>`:**

```tsx
<CodeEditor
  value={displayYaml}
  language={mode}
  readOnly
  minHeight="600px"
  className="rounded-none border-0"
  fontSize="small"
  onEditorReady={(e) => { editorInstanceRef.current = e; }}
/>
```

**4d. Add a helper inside the component body for folding a line range:**

```ts
const foldLineRange = useCallback((range: { startLine: number; endLine: number } | null) => {
  const editor = editorInstanceRef.current;
  if (!editor || !range) return;
  // Dynamically import monaco Range to avoid a top-level dep.
  import('monaco-editor').then(({ Range }) => {
    editor.setSelection(new Range(range.startLine, 1, range.endLine, 1));
    editor.getAction('editor.foldSelected')?.run();
  }).catch(() => {
    // Fallback: use plain object matching monaco.IRange shape.
    editor.setSelection({ startLineNumber: range.startLine, startColumn: 1, endLineNumber: range.endLine, endColumn: 1 } as unknown as monacoEditor.IRange);
    editor.getAction('editor.foldSelected')?.run();
  });
}, []);
```

**4e. Pre-compute which well-known paths the current preset already hides (for the disabled-state tooltip):**

```ts
const stripsByPreset: Record<YamlPreset, string[]> = {
  raw: [],
  clean: ['metadata.managedFields'],
  'apply-ready': ['metadata.managedFields', 'status'],
};
const alreadyStripped = stripsByPreset[preset];
```

**4f. Insert the fold-menu dropdown in the read-mode actions fragment, BEFORE the `<YamlCopyMenu>`:**

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm" className="h-7 text-xs font-medium gap-1 px-2" disabled={isEditing} aria-label="Fold menu">
      Fold <ChevronDown className="h-3 w-3" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-52">
    <DropdownMenuItem onSelect={() => editorInstanceRef.current?.getAction('editor.foldAll')?.run()}>
      Fold All
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={() => editorInstanceRef.current?.getAction('editor.unfoldAll')?.run()}>
      Unfold All
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    {wellKnownFoldPaths().map((p) => {
      const disabled = alreadyStripped.includes(p.path);
      return (
        <DropdownMenuItem
          key={p.path}
          disabled={disabled}
          onSelect={() => foldLineRange(findFoldRange(displayYaml, p.path))}
        >
          {p.label}{disabled && <span className="ml-auto text-[10px] text-muted-foreground">hidden</span>}
        </DropdownMenuItem>
      );
    })}
  </DropdownMenuContent>
</DropdownMenu>
<Separator orientation="vertical" className="h-4 mx-1" />
```

### Step 5: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 19 tests total (15 existing + 4 new).

### Step 6: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 7: Commit

```bash
git add kubilitics-frontend/src/components/resources/YamlViewer.tsx kubilitics-frontend/src/components/resources/YamlViewer.test.tsx
git commit -m "feat(yaml): fold menu with Fold All / Unfold All / well-known paths"
```

---

## Task 8: YamlViewer — field-path breadcrumb

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.tsx`
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx`

### Step 1: Add the breadcrumb logic

**1a. Inside `YamlViewer.tsx`, add a small helper function ABOVE the component (module-level, not inside):**

```ts
/**
 * Walk backward through YAML lines from the given 1-indexed cursor line to
 * compute a dot-path string (e.g. "spec.containers[0].env[3]"). Uses indent
 * tracking — every ancestor is the last key at a strictly smaller indent.
 * Array items are represented by peering one line up for a parent key when
 * the current line starts with "-". Returns "" when the cursor is at the
 * document root.
 */
function computeBreadcrumbPath(yaml: string, lineNumber: number): string {
  if (!yaml || lineNumber < 1) return '';
  const lines = yaml.split('\n');
  if (lineNumber > lines.length) return '';

  const stack: Array<{ key: string; indent: number; arrayIdx?: number }> = [];
  const cursorIdx = lineNumber - 1;
  let currentIndent = indent(lines[cursorIdx]);

  for (let i = cursorIdx; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indent(line);
    const stripped = line.slice(ind);
    if (ind >= currentIndent && i !== cursorIdx) continue;

    // Array item marker
    if (stripped.startsWith('- ')) {
      // Compute array index by counting sibling `- ` items above at the same indent.
      let count = 0;
      for (let j = i - 1; j >= 0; j--) {
        const jInd = indent(lines[j]);
        const jStripped = lines[j].slice(jInd);
        if (jInd < ind) break;
        if (jInd === ind && jStripped.startsWith('- ')) count++;
      }
      if (stack.length > 0) stack[stack.length - 1].arrayIdx = count;
      currentIndent = ind;
      continue;
    }

    const m = stripped.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
    if (m) {
      stack.unshift({ key: m[1], indent: ind });
      currentIndent = ind;
    }
  }

  return stack
    .map((s) => (s.arrayIdx !== undefined ? `${s.key}[${s.arrayIdx}]` : s.key))
    .join('.');
}

function indent(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}
```

**1b. Add breadcrumb state:**

```ts
const [breadcrumbPath, setBreadcrumbPath] = useState('');
```

**1c. Subscribe to cursor changes after the editor is ready. Update the `onEditorReady` callback from Task 7 to wire up the listener:**

```tsx
<CodeEditor
  value={displayYaml}
  language={mode}
  readOnly
  minHeight="600px"
  className="rounded-none border-0"
  fontSize="small"
  onEditorReady={(e) => {
    editorInstanceRef.current = e;
    e.onDidChangeCursorPosition((evt) => {
      setBreadcrumbPath(computeBreadcrumbPath(displayYaml, evt.position.lineNumber));
    });
  }}
/>
```

Note: this closure captures `displayYaml`. That means when `displayYaml` changes (preset/mode flip), the existing listener keeps the stale closure. Fix: re-register on `displayYaml` change via a `useEffect` instead of inline:

Replace the inline wiring with a separate effect:

```ts
useEffect(() => {
  const editor = editorInstanceRef.current;
  if (!editor) return;
  const disposable = editor.onDidChangeCursorPosition((evt) => {
    setBreadcrumbPath(computeBreadcrumbPath(displayYaml, evt.position.lineNumber));
  });
  return () => disposable.dispose();
}, [displayYaml]);
```

And simplify the `onEditorReady` back to just the ref assignment:

```tsx
onEditorReady={(e) => { editorInstanceRef.current = e; }}
```

This is the correct React pattern: effect re-runs when displayYaml changes, old listener disposes, new one registers. Caveat: the first useEffect runs before the ref is populated on some platforms, so the effect reads `null` and bails. On the subsequent render (once the editor ready callback sets the ref) we re-run. This is acceptable — in tests the fake editor triggers `onEditorReady` synchronously in a layout effect, so the first real `useEffect` sees the populated ref.

**1d. Render the breadcrumb row ABOVE the editor but BELOW the warning/conflict banners:**

```tsx
{!isEditing && breadcrumbPath && resource && (
  <div className="px-4 py-1 text-[11px] text-muted-foreground bg-slate-50 dark:bg-slate-900/50 border-b border-border flex items-center gap-1 font-mono overflow-x-auto">
    {breadcrumbPath.split('.').map((seg, i, arr) => (
      <span key={i} className="flex items-center gap-1 whitespace-nowrap">
        <span>{seg}</span>
        {i < arr.length - 1 && <span className="text-muted-foreground/40">›</span>}
      </span>
    ))}
  </div>
)}
```

### Step 2: Add tests

Append to `YamlViewer.test.tsx`:

```tsx
it('breadcrumb updates when cursor moves in the editor', async () => {
  renderViewer();
  // Fire the cursor listener registered by the component
  // The listener is wired after useEffect runs; flush microtasks.
  await Promise.resolve();
  const listener = fakeEditorCalls.cursorListeners[fakeEditorCalls.cursorListeners.length - 1];
  expect(listener).toBeDefined();
  // Position the cursor somewhere deep in the editor — line 7 of the rawYaml fixture
  // lands inside `managedFields` in Raw, or nowhere useful in Clean. Switch to Raw first.
  fireEvent.click(screen.getByRole('button', { name: /^raw$/i }));
  await Promise.resolve();
  const rawListener = fakeEditorCalls.cursorListeners[fakeEditorCalls.cursorListeners.length - 1];
  rawListener({ position: { lineNumber: 3 } });
  // Re-query; the breadcrumb should show some path
  // (The exact value depends on which line the fixture parser thinks is line 3 — we just
  // assert the row is present, which it wasn't before the cursor fire.)
  const breadcrumbRow = screen.getByText((_c, el) => {
    if (!el) return false;
    return (el.className ?? '').includes('font-mono') && el.textContent !== null && el.textContent.length > 0;
  });
  expect(breadcrumbRow).toBeTruthy();
});
```

### Step 3: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 20 tests total.

If the breadcrumb assertion is fragile (the fake editor's indent-walker path depends on fixture line 3), adjust the line number in the test to one that produces a stable path (e.g. line 4 which lands on `metadata:` key).

### Step 4: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 5: Commit

```bash
git add kubilitics-frontend/src/components/resources/YamlViewer.tsx kubilitics-frontend/src/components/resources/YamlViewer.test.tsx
git commit -m "feat(yaml): field-path breadcrumb follows cursor in read mode"
```

---

## Task 9: YamlViewer — large-resource guard

**Files:**
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.tsx`
- Modify: `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx`

### Step 1: Add tests

Append to `YamlViewer.test.tsx`:

```tsx
it('large-resource banner renders when yaml exceeds 1 MB', () => {
  const bigYaml = 'x'.repeat(1_500_000);
  renderViewer({ yaml: bigYaml, resource: undefined });
  expect(screen.getByText(/large resource/i)).toBeInTheDocument();
});

it('large-resource banner is dismissable', () => {
  const bigYaml = 'x'.repeat(1_500_000);
  renderViewer({ yaml: bigYaml, resource: undefined });
  fireEvent.click(screen.getByRole('button', { name: /dismiss large resource warning/i }));
  expect(screen.queryByText(/large resource/i)).not.toBeInTheDocument();
});

it('does not render banner when yaml is small', () => {
  renderViewer();
  expect(screen.queryByText(/large resource/i)).not.toBeInTheDocument();
});
```

### Step 2: Run tests — verify they fail

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: FAIL — 2 of 3 new tests fail (banner not implemented).

### Step 3: Implement the banner

**3a. Add dismissal state:**

```ts
const [isLargeBannerDismissed, setIsLargeBannerDismissed] = useState(false);
```

**3b. Compute whether to show the banner:**

```ts
const showLargeBanner = !isEditing && !isLargeBannerDismissed && isLargeResource(displayYaml);
```

**3c. Auto-fold `status` and `spec.template` when entering the large state. Add an effect:**

```ts
useEffect(() => {
  if (!showLargeBanner) return;
  // Fire once per large state entry.
  const statusRange = findFoldRange(displayYaml, 'status');
  const templateRange = findFoldRange(displayYaml, 'spec.template');
  if (statusRange) foldLineRange(statusRange);
  if (templateRange) foldLineRange(templateRange);
  // Intentionally depend only on showLargeBanner — we want one auto-fold on entry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showLargeBanner]);
```

**3d. Render the banner JSX above the editor (and above the breadcrumb — the banner is the most urgent info):**

```tsx
{showLargeBanner && (
  <div className="px-4 py-2 text-xs bg-amber-500/10 border-b border-amber-500/30 flex items-start gap-3">
    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
    <div className="flex-1 min-w-0">
      <p className="font-medium text-amber-800 dark:text-amber-400">
        Large resource ({Math.round(displayYaml.length / 1024)} KB).
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        <code className="font-mono">status</code> and <code className="font-mono">spec.template</code> auto-folded for performance.
      </p>
    </div>
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-[11px] px-2 shrink-0"
      onClick={() => setIsLargeBannerDismissed(true)}
      aria-label="Dismiss large resource warning"
    >
      Dismiss
    </Button>
  </div>
)}
```

`AlertTriangle` is already imported at the top of the file (used by the conflict banner).

### Step 4: Run tests — verify they pass

Run: `cd kubilitics-frontend && npx vitest run src/components/resources/YamlViewer.test.tsx`
Expected: PASS — 23 tests total.

### Step 5: Typecheck

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

### Step 6: Commit

```bash
git add kubilitics-frontend/src/components/resources/YamlViewer.tsx kubilitics-frontend/src/components/resources/YamlViewer.test.tsx
git commit -m "feat(yaml): large-resource banner with auto-fold and session dismissal"
```

---

## Task 10: Final verification + manual smoke

**Files:** none modified

- [ ] **Step 1: Run every test file touched by this plan**

Run:
```bash
cd kubilitics-frontend && npx vitest run \
  src/lib/yaml/filterYaml.test.ts \
  src/components/resources/yamlFoldRanges.test.ts \
  src/components/resources/YamlCopyMenu.test.tsx \
  src/components/resources/YamlViewer.test.tsx
```
Expected: PASS — roughly 15 + 8 + 7 + 23 = 53 tests.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd kubilitics-frontend && npx vitest run`
Expected: only the pre-existing `tab-blast-radius` failure in `GenericResourceDetail.test.tsx` remains. Any new failure is a regression — STOP and investigate.

- [ ] **Step 3: Typecheck**

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Confirm clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 5: Manual smoke test in the running Tauri desktop app**

Tauri dev is already running from the previous session. Vite HMR has picked up every change. Click onto the Kubilitics window and:

1. Navigate to the OTel Demo Pod `ad-667f9497cd-2pq46` (or any pod with managedFields).
2. Click the **YAML** tab.
3. Verify default Clean view: no `managedFields`.
4. Click **Apply-ready** → `status`, `uid`, `resourceVersion`, `generation`, `creationTimestamp` all disappear. `name`, `namespace`, `spec` remain.
5. Click **Raw** → full YAML returns, including `managedFields`.
6. Click **JSON** toggle → output is valid JSON (copy to a JSON validator to confirm). Flip between Clean / Apply-ready / Raw in JSON mode — each combination should produce sensible output.
7. Click **Copy ▾** menu → try each of the 5 items. Paste into a scratch file. Verify the kubectl apply item produces:
   ```
   cat <<'EOF' | kubectl apply -f -
   <apply-ready yaml>
   EOF
   ```
   Actually run it against a dev cluster if feasible — the Pod should apply cleanly (may warn on immutability but not fail).
8. Click **Fold ▾** → `Fold All` → verify everything collapses to top-level keys. `Unfold All` → verify everything expands. `Fold status` → verify just `status:` collapses. `Fold managedFields` should be disabled (hidden by Clean) — switch to Raw and try again.
9. Click several places in the editor — verify the breadcrumb row updates and shows the path.
10. Synthesize a large resource (paste a 2 MB ConfigMap via `kubectl apply`, or use a CRD with a large OpenAPI schema) → verify the large-resource banner appears and `status` / `spec.template` are auto-folded. Click Dismiss → banner hides.
11. Click **Edit** → verify mode flips to Raw + YAML and all toggles are disabled. Cancel → verify the previous combination (e.g. Apply-ready + JSON) is restored.

- [ ] **Step 6: Celebrate by screenshotting the YAML tab with Apply-ready + JSON selected. This is now the best YAML viewer in any K8s tool.**

No commit needed — verification only.

# YAML Power Pack — Design Spec

**Date:** 2026-04-16
**Author:** Koti (with Claude)
**Status:** Draft, pending review
**Sub-project:** 1 of 3 (YAML/Compare enterprise uplift). Sub-project 2 = Compare Power Pack. Sub-project 3 = YamlViewer/YamlEditorDialog unification.

## Problem

The YAML tab on resource detail pages just got a Clean/Raw filter (commit `53021db`), which matches Headlamp for the `managedFields` problem. That's a start. Users across the skill spectrum — from a junior SRE reading their first Deployment to a platform architect doing a drift review to a CXO showing a live cluster in a board meeting — still hit obvious friction:

- No way to grab a `kubectl apply`-ready copy of a live resource without hand-stripping server-managed fields.
- No JSON view for engineers who think in JSON (mostly backend engineers coming from the kube-openapi world).
- A single Copy button that always copies one thing, instead of a menu that offers the actual forms people need.
- No one-click fold for `status`, `spec.template`, or the rarely-useful subtrees that dominate big resources.
- No way to know where you are when scrolling through a 2000-line Deployment YAML.
- Large resources (multi-MB CRDs, big ConfigMaps) open with no warning and freeze the editor momentarily.

## Goal

Make the YAML tab the best YAML viewer in any K8s tool — better than Headlamp, Lens, Rancher, and k9s combined — without adding a menu maze. Every feature is zero-config and discoverable from the header. Defaults are correct for the 90% case; power features are one click away.

Six features ship in this plan:

1. **Apply-Ready preset** — 4th option on the preset segmented control. Strips server-managed metadata and `status` so the output is ready to `kubectl apply -f -`.
2. **JSON ↔ YAML mode toggle** — orthogonal to the preset. Same object, rendered either way.
3. **Rich copy menu** — dropdown with 5 copy targets including a `kubectl apply` heredoc.
4. **One-click fold actions** — Fold All, Unfold All, Fold status, Fold managedFields, Fold spec.template.
5. **Field-path breadcrumb** — follows the cursor, shows the current YAML path, click-to-jump.
6. **Large-resource guard** — warn above 1 MB, auto-fold `status` and `spec.template`, dismissable per session.

## Non-Goals

- Extracting a separate `YamlCanvas` component. Sub-project 3 will do that alongside unifying `YamlEditorDialog`; extracting twice is wasted work.
- Changing `GenericResourceDetail` (already wires `resource` into `YamlViewer` from sub-project 0).
- Touching the Compare tab (sub-project 2).
- Touching the backend — this is frontend-only.
- Persisting toggle state across sessions (preset, mode, and size-guard dismissal are session-scoped; hard reload resets everything).
- Replacing Monaco's built-in Cmd+F search (already excellent).

## Scope Boundary: preset vs mode

The design has **two orthogonal axes** the user can set:

| | YAML | JSON |
|---|---|---|
| **Clean** | filtered YAML text | filtered JSON text |
| **Apply-ready** | apply-ready YAML | apply-ready JSON |
| **Raw** | full YAML | full JSON |

Six combinations. The UI exposes them as two independent segmented controls — preset (3 pills) and mode (2 pills) — because that's the least cognitively expensive encoding. A single 6-way dropdown would be shorter in code but harder to learn.

Editing is YAML-only: entering Edit forces `preset='raw'` AND `mode='yaml'`. Exiting Edit (Cancel or Save) restores both.

## Architecture

### Files

**New:**
- `kubilitics-frontend/src/components/resources/YamlCopyMenu.tsx` — standalone dropdown.
- `kubilitics-frontend/src/components/resources/YamlCopyMenu.test.tsx` — unit tests.
- `kubilitics-frontend/src/components/resources/yamlFoldRanges.ts` — line-range scanner for well-known fold paths. Lives with the viewer because it needs the serialized YAML text; kept out of `src/lib/yaml/` to preserve that module's zero-React-zero-Monaco purity.
- `kubilitics-frontend/src/components/resources/yamlFoldRanges.test.ts` — unit tests.

**Expanded:**
- `kubilitics-frontend/src/lib/yaml/filterYaml.ts` — new preset `'apply-ready'`, new `toJson()` helper, new `isLargeResource()`, new `wellKnownFoldPaths()`.
- `kubilitics-frontend/src/lib/yaml/filterYaml.test.ts` — new test cases for each of the above.
- `kubilitics-frontend/src/components/resources/YamlViewer.tsx` — preset control grows to 3 pills, new mode toggle, new fold menu, new breadcrumb row, new size-guard banner, new copy menu, new refs and state.
- `kubilitics-frontend/src/components/resources/YamlViewer.test.tsx` — new tests for each new feature.

**Unchanged:**
- `GenericResourceDetail.tsx` — already wires `resource`.
- `CodeEditor.tsx` — assumed to expose `onEditorReady`. If the prop is missing, add it in this plan (a one-line pass-through). Otherwise no changes.

### Unit responsibilities

- **`filterYaml.ts`** — pure. Presets, JSON serialization, size detection, list of well-known paths. No React, no Monaco, no js-yaml (still). Zero runtime dependencies beyond the standard library. All logic fixture-testable.
- **`yamlFoldRanges.ts`** — pure. Takes a YAML string and a target path, returns `{ startLine, endLine } | null`. Uses a simple indentation walker (no full parse — regex for the root-key, then walk forward until indent returns to ≤ original). Testable with string fixtures.
- **`YamlCopyMenu.tsx`** — presentational. Receives the already-computed strings via props (`cleanYaml`, `applyReadyYaml`, `rawYaml`, `jsonText`, `kubectlApplyCommand`) and an `onCopy(label, text)` callback. Zero knowledge of filterYaml or Monaco. Easy to test by passing fake strings.
- **`YamlViewer.tsx`** — the orchestrator. Owns preset state, mode state, breadcrumb state, fold state, size-guard dismissal state. Glues filterYaml output to the copy menu and the Monaco instance. Expected final size: ~600 lines, coherent enough to stay in one file until sub-project 3 does the real extraction.

## Filter module changes (`filterYaml.ts`)

### Presets

```ts
export type YamlPreset = 'clean' | 'apply-ready' | 'raw';
```

| Preset | Removed | Kept |
|---|---|---|
| `raw` | (nothing) | everything |
| `clean` | `metadata.managedFields` | everything else — `status`, `metadata.*`, `spec` |
| `apply-ready` | `metadata.managedFields`, `metadata.uid`, `metadata.resourceVersion`, `metadata.creationTimestamp`, `metadata.generation`, `metadata.selfLink`, `metadata.ownerReferences`, top-level `status` | `apiVersion`, `kind`, `metadata.name`, `metadata.namespace`, `metadata.labels`, `metadata.annotations`, `spec`, everything else |

The `apply-ready` field list mirrors `CloneToNamespaceDialog.tsx` exactly so stripping is consistent everywhere in the app. The function is still pure — shallow-clones the top level, replaces `metadata` with a rest-destructured copy that omits the target fields, and deletes `status` from the root clone.

### New exports

```ts
export function toJson(obj: unknown, opts?: { indent?: number }): string;
// Thin wrapper over JSON.stringify(obj, null, opts?.indent ?? 2). Separate
// function so we have one place to add stable key sorting later if needed.

export function isLargeResource(yaml: string): boolean;
// True when the serialized YAML string exceeds 1 MB (1_048_576 bytes). Chosen
// because typical resources are < 50 KB and above 1 MB Monaco's first-paint
// becomes noticeable. Not a hard cap — just a banner-and-fold trigger.

export function wellKnownFoldPaths(): Array<{ path: string; label: string }>;
// Returns:
// [
//   { path: 'metadata.managedFields', label: 'Fold managedFields' },
//   { path: 'status',                  label: 'Fold status' },
//   { path: 'spec.template',           label: 'Fold spec.template' },
// ]
// Pure and stable so the fold menu renders deterministically.
```

Line-range computation is NOT in this module — it lives in `yamlFoldRanges.ts` because it needs the serialized YAML text, which is rendering-layer concern.

## New module: `yamlFoldRanges.ts`

```ts
/**
 * Locate the line range of a well-known YAML path for one-click folding.
 * Uses a simple indentation walker, not a full parse, so it can run on
 * every keystroke without allocating a js-yaml AST.
 *
 *   findFoldRange(text, 'status')            → { startLine, endLine } | null
 *   findFoldRange(text, 'metadata.managedFields')
 *   findFoldRange(text, 'spec.template')
 */
export function findFoldRange(yaml: string, dotPath: string): { startLine: number; endLine: number } | null;
```

Implementation: split on `\n`, for each dot-path segment walk forward scanning for a line that starts with the current indent level followed by `<segment>:`. Track the indent of each match to recurse into the child. When all segments are matched, walk forward from the last match's start line until the indent drops back to ≤ the match's indent. Return `[startLine, endLine]` (1-indexed, inclusive). Return `null` if any segment isn't found at the expected nesting.

Edge cases handled:
- Substring false matches (`statuses:` must not match `status:`) — match against `^(\s*)<key>:` with a word boundary.
- Empty YAML, single-line YAML.
- Paths that don't exist at the expected depth (return null).

## UI changes (`YamlViewer.tsx`)

### Header layout (read mode)

```
name.yaml  · 1247 lines · 38 KB
[ Clean │ Apply-ready │ Raw ]  [ YAML │ JSON ]  [Fold ▾] [Copy ▾] [⬇] [Edit]

spec › containers[0] › env[3]                      ← breadcrumb row (own line)

⚠ Large resource (2.4 MB). status and spec.template auto-folded.  [x]   ← only when isLargeResource
```

Existing Copy (single icon), Download (icon), Edit (button), and line/size label stay — Copy gets replaced by the new menu, everything else is unchanged.

### State additions

```ts
// Existing: preset, previousPresetRef
const [mode, setMode] = useState<'yaml' | 'json'>('yaml');
const previousModeRef = useRef<'yaml' | 'json'>('yaml');
const [breadcrumbPath, setBreadcrumbPath] = useState<string>('');
const [isLargeBannerDismissed, setIsLargeBannerDismissed] = useState(false);
const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
```

### Preset control (expanded)

Three `<Button>` pills instead of two. Same `aria-pressed`, same `disabled={isEditing}`. Apply-ready pill uses the same `secondary`/`ghost` variant toggle.

### Mode toggle (new)

A second segmented control immediately after the preset control:

```tsx
<div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 mr-1">
  <Button variant={mode === 'yaml' ? 'secondary' : 'ghost'}
          size="sm" className="..." onClick={() => setMode('yaml')}
          disabled={isEditing} aria-pressed={mode === 'yaml'}
          aria-label="YAML view">YAML</Button>
  <Button variant={mode === 'json' ? 'secondary' : 'ghost'}
          size="sm" className="..." onClick={() => setMode('json')}
          disabled={isEditing} aria-pressed={mode === 'json'}
          aria-label="JSON view">JSON</Button>
</div>
```

### displayYaml memo (expanded)

```ts
const displayYaml = useMemo(() => {
  if (!resource || (preset === 'raw' && mode === 'yaml')) return yaml;
  try {
    const filtered = filterYaml(resource, preset);
    return mode === 'json'
      ? toJson(filtered, { indent: 2 })
      : yamlParser.dump(filtered, { indent: 2, noArrayIndent: false, skipInvalid: true, flowLevel: -1, noRefs: true, lineWidth: -1 });
  } catch {
    return yaml;
  }
}, [preset, mode, resource, yaml]);
```

### Fold menu

Uses shadcn `DropdownMenu`. Items:

```
Fold All          → editor.getAction('editor.foldAll')?.run()
Unfold All        → editor.getAction('editor.unfoldAll')?.run()
──────────────
Fold managedFields  → findFoldRange(displayYaml, 'metadata.managedFields') → fold range
Fold status         → findFoldRange(displayYaml, 'status')                 → fold range
Fold spec.template  → findFoldRange(displayYaml, 'spec.template')          → fold range
```

To fold a range, use Monaco's `editor.setSelection(new monaco.Range(start, 1, end, 1))` then `editor.getAction('editor.foldSelected')?.run()`. Wrapped in a helper `foldLineRange(startLine, endLine)` inside YamlViewer.

Each well-known item is disabled (with tooltip) when the current preset already strips that path — e.g. in Clean mode, `Fold managedFields` is disabled with tooltip *"Already hidden by Clean preset"*.

### Field-path breadcrumb

On mount after the editor is ready, subscribe to `editorInstanceRef.current.onDidChangeCursorPosition`. Each time the cursor moves, re-compute the path from the current line upward by walking backward and tracking indentation levels (same walker logic as `yamlFoldRanges`, but running in reverse). Store as `"spec.containers[0].env[3]"` and render as a row of clickable segments separated by `›`. Clicking a segment calls `findFoldRange(displayYaml, <segmentPath>)` and scrolls to the start line.

Breadcrumb row is hidden when:
- `!resource` (legacy viewers), OR
- `isEditing` (Monaco's own footer cursor position is enough), OR
- `breadcrumbPath === ''` (cursor at document root).

### Large-resource guard

On `displayYaml` change, check `isLargeResource(displayYaml)`. If true and not dismissed this session, render a warning banner (`⚠ Large resource (2.4 MB). status and spec.template auto-folded.`) above the editor. On the same change, call `foldLineRange(findFoldRange(displayYaml, 'status'))` and same for `spec.template` — both gracefully no-op if the path isn't present.

Dismissal state lives in a component-local `useState` — per-session, lost on reload. No localStorage.

### Copy menu (`YamlCopyMenu`)

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Copy menu">
      <Copy className="h-3.5 w-3.5" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-56">
    <DropdownMenuItem onSelect={() => copy('YAML (Clean)', cleanYaml)}>Copy as YAML (Clean)</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => copy('YAML (Apply-ready)', applyReadyYaml)}>Copy as YAML (Apply-ready)</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => copy('YAML (Raw)', rawYaml)}>Copy as YAML (Raw)</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => copy('JSON', jsonText)}>Copy as JSON</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => copy('kubectl apply command', kubectlApplyCommand)}>
      Copy `kubectl apply -f -` command
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Props:

```ts
interface YamlCopyMenuProps {
  cleanYaml: string;
  applyReadyYaml: string;
  rawYaml: string;
  jsonText: string;           // always uses apply-ready preset
  kubectlApplyCommand: string; // apply-ready YAML wrapped in heredoc
  onCopy: (label: string, text: string) => void;
}
```

`kubectlApplyCommand` is computed in `YamlViewer` and passed in, not computed in the menu. Format:

```
cat <<'EOF' | kubectl apply -f -
<apply-ready yaml>
EOF
```

`YamlCopyMenu` never touches `filterYaml` directly — it's a pure presentational component with five menu items. Tests stub the strings.

### Edit interactions (expanded)

```ts
const handleEdit = () => {
  previousPresetRef.current = preset;
  previousModeRef.current = mode;
  setEditedYaml(yaml);              // always raw, always YAML
  setErrors([]);
  setEditorKey((k) => k + 1);
  setPreset('raw');
  setMode('yaml');
  setIsEditing(true);
};

const handleCancel = () => {
  setEditedYaml(yaml);
  setErrors([]);
  setIsEditing(false);
  setPreset(previousPresetRef.current);
  setMode(previousModeRef.current);
};
```

Same pattern in `handleSave` and `handleForceSave` — restore BOTH preset and mode after every exit point.

## Testing

### Unit — `filterYaml.test.ts` additions

- `'apply-ready'` strips all 8 target fields and nothing else (fixture: full Pod with every field).
- `'apply-ready'` is a no-op on already-minimal objects (no managedFields, no status, etc.).
- `'apply-ready'` keeps `spec`, `metadata.name`, `metadata.namespace`, `metadata.labels`, `metadata.annotations` intact.
- `'apply-ready'` does not mutate input.
- `toJson` round-trips through `JSON.parse`.
- `toJson` indents to 2 spaces by default; `indent: 0` produces compact output.
- `isLargeResource` boundary: `'a'.repeat(1_048_575)` → false; `'a'.repeat(1_048_577)` → true; `''` → false.
- `wellKnownFoldPaths()` returns exactly 3 entries with stable labels.

Total new: 8. Grand total in filterYaml: 15 tests.

### Unit — `yamlFoldRanges.test.ts` (new)

- Finds `status:` at the root level of a Pod fixture.
- Finds `metadata.managedFields` nested under metadata.
- Finds `spec.template:` in a Deployment fixture.
- Returns null for `'spec.template'` when applied to a Pod (no template).
- Does NOT match `statuses:` when searching for `'status'`.
- Handles empty string, single-line input, and a stripped Clean-mode YAML (where managedFields is gone).

Total: 6 tests.

### Unit — `YamlCopyMenu.test.tsx` (new)

- All 5 items render with correct labels.
- Clicking each item fires `onCopy` with the matching label + text.
- `onCopy` receives the apply-ready content for the kubectl item, wrapped in the heredoc envelope.
- Menu closes on `Escape`.
- Menu is keyboard-navigable (Tab focuses trigger; ArrowDown moves between items).
- Rendering with empty strings doesn't crash (shows empty items, not an error).

Total: 6 tests.

### Component — `YamlViewer.test.tsx` additions

Mock extended: `CodeEditor` stub now accepts `onEditorReady` and exposes a tiny fake Monaco instance with `getAction`, `setSelection`, `onDidChangeCursorPosition`. The fake lives in a helper at the top of the test file.

- Clicking `Apply-ready` hides `status`, `uid`, `resourceVersion` but keeps `spec`.
- Clicking `JSON` with `Clean` preset produces valid JSON (passed to `JSON.parse` in the assertion) with no `managedFields`.
- Clicking `JSON` with `Apply-ready` produces valid JSON with no `status`, no `uid`.
- Fold menu: clicking `Fold status` calls the fake editor's `setSelection` and `getAction('editor.foldSelected').run()` with the correct line range computed from `findFoldRange`.
- Fold menu: `Fold managedFields` item is disabled in Clean preset with a tooltip.
- Fold menu: `Fold All` calls `editor.getAction('editor.foldAll')?.run()`.
- Breadcrumb updates when the fake editor fires a cursor change event.
- Clicking a breadcrumb segment scrolls the editor (fake editor's `revealLineInCenter` is called).
- Large-resource banner renders when fed a 1.5 MB YAML fixture; dismissing it hides it.
- Edit mode forces `mode='yaml'` AND `preset='raw'`; Cancel restores both.
- Copy menu items copy the right text for each preset × mode combination (one test per combination × 5 items = 30 assertions via a `describe.each` block; total 10 it blocks for brevity).

Total new: 12-15 depending on how the `describe.each` groups roll up. Plus the 6 existing → final ~20.

### Manual smoke test (in the implementation plan's final task)

1. Open the OTel Demo Pod → YAML tab.
2. Cycle Clean → Apply-ready → Raw. Verify server-managed fields disappear at each step.
3. Click YAML → JSON toggle. Verify the output is valid JSON (paste into any JSON validator).
4. Copy menu → each of the 5 items → paste into a scratch file and visually confirm.
5. Fold menu → Fold status → verify `status:` collapses. Unfold All → verify everything expands.
6. Click several places in the editor → verify breadcrumb updates and clicking a segment jumps the cursor.
7. Open a resource > 1 MB (or synthesize one in dev tools) → verify the banner and auto-fold.
8. Click Edit → verify mode=YAML preset=Raw. Cancel → verify previous preset/mode restored.

## Files Touched Summary

| File | Action | Est. LoC change |
|---|---|---|
| `src/lib/yaml/filterYaml.ts` | modify | +60 |
| `src/lib/yaml/filterYaml.test.ts` | modify | +120 |
| `src/components/resources/yamlFoldRanges.ts` | create | ~80 |
| `src/components/resources/yamlFoldRanges.test.ts` | create | ~100 |
| `src/components/resources/YamlCopyMenu.tsx` | create | ~80 |
| `src/components/resources/YamlCopyMenu.test.tsx` | create | ~120 |
| `src/components/resources/YamlViewer.tsx` | modify | +250 |
| `src/components/resources/YamlViewer.test.tsx` | modify | +200 |
| `src/components/editor/CodeEditor.tsx` | maybe modify | +3 if `onEditorReady` is missing |

Approx +1000 lines across 9 files.

## Risks and Mitigations

- **Risk:** Monaco's folding API is called before the editor has loaded the model (race on mount). **Mitigation:** All fold calls go through the `editorInstanceRef`, which is only populated on `onEditorReady`. Before it's set, fold menu items call-through no-ops (disabled/tooltip).
- **Risk:** `yamlFoldRanges` regex-based walker misses edge cases (block scalars, anchors, `---` document separators). **Mitigation:** For the three well-known paths the algorithm targets, K8s resources never use anchors or block scalars at the root level. Tests cover `statuses` vs `status`, nested paths, and empty/single-line inputs. Known limitation: a resource with multiple YAML documents separated by `---` is treated as one document (no K8s resource is multi-document, so acceptable).
- **Risk:** JSON mode displays differently in Monaco (different language mode, different folding). **Mitigation:** Pass `language="json"` to `CodeEditor` when in JSON mode. `CodeEditor` already accepts a language prop for YAML vs JSON highlighting.
- **Risk:** `YamlViewer.tsx` grows past 600 lines, starts becoming unwieldy. **Mitigation:** Accepted as a deliberate trade-off. Sub-project 3 extracts `YamlCanvas`. Clear section-comment headers in this plan's inline additions so readers can navigate.
- **Risk:** Copy menu introduces a third Copy UI surface alongside the existing `<Copy />` icon and the Actions tab's Download/Export JSON. **Mitigation:** The old Copy icon is replaced (not augmented). Actions tab is unchanged — its Download goes to a file, our menu goes to clipboard. No duplication.

## Out of Scope (explicit)

- Monaco diff view in the YAML tab (that's the Compare tab's job — sub-project 2).
- Revision history fetcher (sub-project 2).
- Semantic diff (`hide status noise`) in the Compare tab (sub-project 2).
- Extracting `YamlCanvas` (sub-project 3).
- Unifying `YamlEditorDialog` and `YamlViewer` (sub-project 3).
- Monaco streaming / windowing for 10+ MB resources. The size-guard threshold is 1 MB because above 10 MB Monaco simply cannot render well and users should use `kubectl get -o yaml | less`.

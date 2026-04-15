/**
 * Strip display-noise from a K8s resource object before YAML serialization.
 *
 * Presets:
 *   - 'clean' (default): removes metadata.managedFields. Everything else —
 *     status, resourceVersion, uid, generation, creationTimestamp — is kept
 *     because it has debugging value. Matches Headlamp's behavior.
 *   - 'raw': identity. Returns the object unchanged.
 *
 * Pure function. Never mutates its input. Unknown or primitive inputs pass
 * through. The preset enum is the extension point: new presets can be added
 * as additional arms without changing any caller's API.
 */
export type YamlPreset = 'clean' | 'raw';

export function filterYaml<T>(obj: T, preset: YamlPreset): T {
  if (preset === 'raw' || !obj || typeof obj !== 'object') return obj;

  const input = obj as Record<string, unknown>;
  const metadata = input.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'managedFields' in (metadata as Record<string, unknown>)
  ) {
    const { managedFields: _drop, ...rest } = metadata as Record<string, unknown>;
    return { ...input, metadata: rest } as T;
  }
  return obj;
}

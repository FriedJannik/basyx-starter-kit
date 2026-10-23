import type { SerializableStarterState } from '@/stores/app';
import type { ComposeService } from '@/utils/optionalServices';
import catalogSource from '@/public/third-party-services.yaml?raw';
import {
  buildThirdPartyServiceCompose,
  parseThirdPartyServiceCatalog,
  resolveThirdPartyServiceReferences,
} from '@/utils/thirdPartyServices';

/** Sets mirror the Compose structure so the existing secret redaction still applies. */
export interface ThirdPartyServiceOverrides {
  set: Record<string, unknown>;
  remove: string[][];
}

let catalog: ReturnType<typeof parseThirdPartyServiceCatalog> | undefined;
function bundledCatalog(): ReturnType<typeof parseThirdPartyServiceCatalog> {
  return (catalog ||= parseThirdPartyServiceCatalog(catalogSource));
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function differences(
  current: unknown,
  baseline: unknown,
  removed: string[][],
  path: string[] = []
): unknown {
  if (JSON.stringify(current) === JSON.stringify(baseline)) return undefined;
  if (!record(current) || !record(baseline)) return current;
  const entries = Object.keys(current).flatMap(key => {
    const next = differences(current[key], baseline[key], removed, [...path, key]);
    return next === undefined ? [] : [[key, next]];
  });
  Object.keys(baseline).forEach(key => {
    if (!Object.hasOwn(current, key)) removed.push([...path, key]);
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function applyOverrides(
  base: Record<string, unknown>,
  overrides: ThirdPartyServiceOverrides
): Record<string, unknown> {
  const merge = (base: unknown, changes: unknown): unknown => {
    if (!record(base) || !record(changes)) return clone(changes);
    return Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(changes)])].map(key => [
        key,
        Object.hasOwn(changes, key) ? merge(base[key], changes[key]) : clone(base[key]),
      ])
    );
  };
  const result = merge(base, overrides.set) as Record<string, unknown>;
  overrides.remove.forEach(path => {
    let parent: unknown = result;
    for (const key of path.slice(0, -1)) {
      if (!record(parent) || !Object.hasOwn(parent, key)) return;
      parent = parent[key];
    }
    const key = path.at(-1);
    if (record(parent) && key) Reflect.deleteProperty(parent, key);
  });
  return result;
}

/** Keep legacy/custom catalogues expanded when no bundled baseline can reconstruct them. */
export function compactThirdPartySnapshot(
  snapshot: SerializableStarterState
): SerializableStarterState {
  const selections = snapshot.thirdPartyServices;
  const root = snapshot.dockerComposeConfig?.value;
  const baseline = snapshot.thirdPartyServiceDefaults;
  if (!selections?.length || !record(root) || !record(root.services) || !baseline) return snapshot;
  const services = selections.map(selection =>
    bundledCatalog().find(service => service.id === selection.id)
  );
  if (services.some(service => !service)) return snapshot;
  const ids = services.flatMap(service => Object.keys(service!.compose));
  if (ids.some(id => !Object.hasOwn(baseline, id))) return snapshot;
  const current = Object.fromEntries(
    ids
      .filter(id => Object.hasOwn(root.services as object, id))
      .map(id => [id, (root.services as Record<string, unknown>)[id]])
  );
  const generated = Object.fromEntries(ids.map(id => [id, baseline[id]]));
  const remove: string[][] = [];
  const set = (differences(current, generated, remove) || {}) as Record<string, unknown>;
  const result = {
    ...snapshot,
    dockerComposeConfig: {
      ...snapshot.dockerComposeConfig,
      value: {
        ...root,
        services: Object.fromEntries(
          Object.entries(root.services).filter(([id]) => !ids.includes(id))
        ),
      },
    },
    thirdPartyServiceOverrides: { set, remove },
  };
  Reflect.deleteProperty(result, 'thirdPartyServiceDefaults');
  return result;
}

/** Rebuild generated services and their merge baseline before applying explicit user edits. */
export function expandThirdPartySnapshot(
  snapshot: Record<string, unknown>
): Record<string, unknown> {
  const overrides = snapshot.thirdPartyServiceOverrides;
  const config = snapshot.dockerComposeConfig;
  if (
    !record(overrides) ||
    !record(overrides.set) ||
    !Array.isArray(overrides.remove) ||
    !overrides.remove.every(
      path => Array.isArray(path) && path.every(key => typeof key === 'string')
    ) ||
    !record(config) ||
    !record(config.value) ||
    !record(config.value.services) ||
    !Array.isArray(snapshot.thirdPartyServices)
  )
    return snapshot;
  const selections = snapshot.thirdPartyServices;
  if (
    !selections.every(
      selection => record(selection) && typeof selection.id === 'string' && record(selection.values)
    )
  )
    return snapshot;
  const services = selections.flatMap(selection =>
    bundledCatalog().filter(service => service.id === selection.id)
  );
  const templates = Object.assign({}, ...services.map(service => service.compose)) as Record<
    string,
    ComposeService
  >;
  const patch = overrides as unknown as ThirdPartyServiceOverrides;
  // Apply port/name overrides before resolving placeholders that depend on them.
  const candidates = { ...config.value.services, ...applyOverrides(templates, patch) } as Record<
    string,
    ComposeService
  >;
  const resolution = resolveThirdPartyServiceReferences(
    services,
    Object.fromEntries(selections.map(selection => [selection.id, selection.values])),
    candidates
  );
  const generated = Object.assign(
    {},
    ...services.map(service =>
      buildThirdPartyServiceCompose(service, resolution.values[service.id] || {})
    )
  ) as Record<string, ComposeService>;
  return {
    ...snapshot,
    dockerComposeConfig: {
      ...config,
      value: {
        ...config.value,
        services: { ...config.value.services, ...applyOverrides(generated, patch) },
      },
    },
    thirdPartyServiceDefaults: generated,
  };
}

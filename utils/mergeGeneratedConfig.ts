function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeEnvironment(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.environment)) return value;
  return {
    ...value,
    environment: Object.fromEntries(
      value.environment.map((entry: string) => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [entry, null]
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      })
    ),
  };
}

/** Three-way merge: update generated values while retaining explicit user edits. */
export function mergeGeneratedConfig<T>(
  current: T | undefined,
  previous: T | undefined,
  next: T
): T {
  const merge = (current: unknown, previous: unknown, next: unknown): unknown => {
    if (current === undefined || JSON.stringify(current) === JSON.stringify(previous)) return next;
    if (record(current) && record(previous) && record(next)) {
      return Object.fromEntries(
        [...new Set([...Object.keys(current), ...Object.keys(next)])].flatMap(key => {
          if (!(key in current) && key in previous) return [];
          const value = merge(current[key], previous[key], next[key]);
          return value === undefined ? [] : [[key, value]];
        })
      );
    }
    return current;
  };
  const actual = normalizeEnvironment(current);
  const baseline = normalizeEnvironment(previous);
  const generated = normalizeEnvironment(next);
  let result: unknown;
  if (previous === undefined && record(actual) && record(generated)) {
    // Older snapshots have no baseline: preserve Docker-level edits, refresh app settings.
    result = {
      ...generated,
      ...actual,
      ...(record(actual.environment) || record(generated.environment)
        ? {
            environment: {
              ...(record(actual.environment) ? actual.environment : {}),
              ...(record(generated.environment) ? generated.environment : {}),
            },
          }
        : {}),
    };
  } else result = merge(actual, baseline, generated);
  if (
    record(result) &&
    record(result.environment) &&
    ((record(current) && Array.isArray(current.environment)) ||
      (record(next) && Array.isArray(next.environment)))
  ) {
    result = {
      ...result,
      environment: Object.entries(result.environment).map(([key, value]) =>
        value === null ? key : `${key}=${value}`
      ),
    };
  }
  return result as T;
}

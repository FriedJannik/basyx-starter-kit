import type { SerializableStarterState } from '@/stores/app';
import lzString from 'lz-string';

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = lzString;

export const CONFIG_HASH_KEY = 'cfg';
export const CONFIG_QUERY_KEY = CONFIG_HASH_KEY;
export const CONFIG_HASH_VERSION = 'v1';
export const CONFIG_URL_WARNING_LENGTH = 6000;

const SENSITIVE_KEY_PATTERN =
  /(password|(?:^|[_-])pass(?:$|[_-])|token|secret|private.?key|api[-_]?key|credential|salt|connectionstrings?)/i;

export interface PersistedConfigPayloadV1 {
  route: string;
  state: SerializableStarterState;
}

export interface DecodedConfigHash {
  version: string;
  payload?: PersistedConfigPayloadV1;
  error?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function redactEnvEntry(entry: string): string | undefined {
  const [key, ...rest] = entry.split('=');
  if (!key || rest.length === 0) {
    return entry;
  }
  if (isSensitiveKey(key)) {
    return undefined;
  }
  return entry;
}

function stripSensitive(value: unknown): unknown {
  if (
    typeof File !== 'undefined' &&
    (value instanceof File ||
      value instanceof Blob ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value))
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') {
          return redactEnvEntry(item);
        }
        return stripSensitive(item);
      })
      .filter(item => item !== undefined);
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    Object.keys(value).forEach(key => {
      if (isSensitiveKey(key)) {
        return;
      }
      const next = stripSensitive(value[key]);
      if (next !== undefined) {
        result[key] = next;
      }
    });
    return result;
  }

  return value;
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stableSort(item));
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = stableSort(value[key]);
          return acc;
        },
        {} as Record<string, unknown>
      );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

export function buildPersistedPayload(payload: PersistedConfigPayloadV1): PersistedConfigPayloadV1 {
  const sanitized = stripSensitive(payload) as PersistedConfigPayloadV1;
  return {
    route: sanitized.route,
    state: sanitized.state,
  };
}

export function encodeConfigHash(payload: PersistedConfigPayloadV1): string {
  const sanitized = buildPersistedPayload(payload);
  const canonical = canonicalStringify(sanitized);
  const compressed = compressToEncodedURIComponent(canonical);
  return `${CONFIG_HASH_VERSION}.${compressed}`;
}

export function decodeConfigHash(encoded: string | null | undefined): DecodedConfigHash {
  if (!encoded) {
    return { version: CONFIG_HASH_VERSION, error: 'Missing config payload' };
  }

  const separatorIndex = encoded.indexOf('.');
  if (separatorIndex === -1) {
    return { version: 'unknown', error: 'Invalid config payload format' };
  }

  const version = encoded.slice(0, separatorIndex);
  const compressed = encoded.slice(separatorIndex + 1);
  if (version !== CONFIG_HASH_VERSION) {
    return { version, error: `Unsupported config payload version: ${version}` };
  }

  const json = decompressFromEncodedURIComponent(compressed);
  if (!json) {
    return { version, error: 'Unable to decompress config payload' };
  }

  try {
    const parsed = JSON.parse(json) as PersistedConfigPayloadV1;
    if (!parsed || typeof parsed !== 'object') {
      return { version, error: 'Decoded payload is invalid' };
    }
    if (typeof parsed.route !== 'string') {
      return { version, error: 'Decoded payload route is invalid' };
    }
    if (!isPlainObject(parsed.state)) {
      return { version, error: 'Decoded payload state is invalid' };
    }
    return { version, payload: parsed };
  } catch {
    return { version, error: 'Decoded payload is not valid JSON' };
  }
}

export function parseHashParams(hashValue: string): URLSearchParams {
  const normalized = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue;
  return new URLSearchParams(normalized.replace(/\+/g, '%2B'));
}

export function setHashParam(hashValue: string, key: string, value: string): string {
  const params = parseHashParams(hashValue);
  params.set(key, value);
  const serialized = params.toString();
  return serialized ? `#${serialized}` : '';
}

export function parseQueryParams(queryValue: string): URLSearchParams {
  const normalized = queryValue.startsWith('?') ? queryValue.slice(1) : queryValue;
  return new URLSearchParams(normalized.replace(/\+/g, '%2B'));
}

export function setQueryParam(queryValue: string, key: string, value: string): string {
  const params = parseQueryParams(queryValue);
  params.set(key, value);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function removeQueryParam(queryValue: string, key: string): string {
  const params = parseQueryParams(queryValue);
  params.delete(key);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function readConfigHashFromUrl(hashValue: string): string | null {
  const params = parseHashParams(hashValue);
  return params.get(CONFIG_HASH_KEY);
}

export function readConfigQueryFromUrl(queryValue: string): string | null {
  const params = parseQueryParams(queryValue);
  return params.get(CONFIG_QUERY_KEY);
}

export function readConfigQueryValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const firstString = value.find(item => typeof item === 'string');
    return typeof firstString === 'string' ? firstString : null;
  }
  return null;
}

export function shouldWarnForLength(url: string, threshold = CONFIG_URL_WARNING_LENGTH): boolean {
  return url.length > threshold;
}

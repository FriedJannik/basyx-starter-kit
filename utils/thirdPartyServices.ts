import type { ClientArchitecture } from '@/utils/clientArchitecture';
import type { ComposeService } from '@/utils/optionalServices';
import * as yaml from 'js-yaml';
import { findComposePortConflicts } from '@/utils/composePorts';
import { isSensitiveKey } from '@/utils/configPersistence';

export type ThirdPartyFieldType = 'text' | 'number' | 'password' | 'switch' | 'select';
export type ThirdPartyValue = string | number | boolean | undefined;

export interface ThirdPartyReferenceResolution {
  values: Record<string, Record<string, ThirdPartyValue>>;
  errors: string[];
}

export interface ThirdPartyServiceField {
  key: string;
  label: string;
  type: ThirdPartyFieldType;
  environment?: string;
  /** Compose container id; inferred only for single-container entries. */
  service?: string;
  description?: string;
  required?: boolean;
  minLength?: number;
  generate?: 'hex-32' | 'base64-32';
  default?: string | number | boolean;
  arm64Default?: string;
  options?: Array<{ title: string; value: string }>;
}

export interface ThirdPartyService {
  id: string;
  name: string;
  description: string;
  tags: string[];
  compose: Record<string, ComposeService>;
  legacyComposeIds?: string[];
  /** Architectures with no supported image, mapped to a user-facing reason. */
  unsupportedArchitectures?: Partial<Record<'amd64' | 'arm64', string>>;
  configuration: ThirdPartyServiceField[];
}

const RESERVED_SERVICE_IDS = new Set([
  'aas-environment',
  'db',
  'basyx_configuration',
  'aas-ui',
  'influxdb',
  'telegraf',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneCompose<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function parseField(value: unknown, serviceId: string): ThirdPartyServiceField {
  if (!isRecord(value)) throw new Error(`Configuration field for ${serviceId} must be an object.`);
  const type = asString(
    value.type,
    `Configuration field type for ${serviceId}`
  ) as ThirdPartyFieldType;
  if (!['text', 'number', 'password', 'switch', 'select'].includes(type)) {
    throw new Error(`Unsupported configuration field type '${type}' for ${serviceId}.`);
  }
  const options = Array.isArray(value.options)
    ? value.options.map(option => {
        if (!isRecord(option)) throw new Error(`Select option for ${serviceId} must be an object.`);
        return {
          title: asString(option.title, 'Select option title'),
          value: asString(option.value, 'Select option value'),
        };
      })
    : undefined;
  if (type === 'select' && !options?.length)
    throw new Error(`Select field for ${serviceId} needs options.`);
  if (
    value.generate !== undefined &&
    (type !== 'password' ||
      !['hex-32', 'base64-32'].includes(String(value.generate)) ||
      value.default !== undefined)
  )
    throw new Error(
      `Generated fields for ${serviceId} must be password fields using hex-32/base64-32 without a static default.`
    );
  if (
    value.minLength !== undefined &&
    (!['text', 'password'].includes(type) ||
      !Number.isSafeInteger(value.minLength) ||
      Number(value.minLength) < 1)
  )
    throw new Error(
      `Minimum length for ${serviceId} must be a positive integer on a text/password field.`
    );
  const arm64Default =
    value.arm64Default === undefined
      ? undefined
      : asString(value.arm64Default, `ARM64 default for ${serviceId}`);
  if (
    arm64Default !== undefined &&
    (!['text', 'select'].includes(type) ||
      typeof value.default !== 'string' ||
      (type === 'select' && !options?.some(option => option.value === arm64Default)))
  )
    throw new Error(
      `ARM64 default for ${serviceId} needs a text/select field with a normal default and a matching option.`
    );
  return {
    key: asString(value.key, `Configuration field key for ${serviceId}`),
    label: asString(value.label, `Configuration field label for ${serviceId}`),
    type,
    environment: typeof value.environment === 'string' ? value.environment : undefined,
    service:
      value.service === undefined
        ? undefined
        : asString(value.service, `Environment target for ${serviceId}`),
    description: typeof value.description === 'string' ? value.description : undefined,
    required: value.required === true,
    generate: value.generate as ThirdPartyServiceField['generate'],
    minLength: typeof value.minLength === 'number' ? value.minLength : undefined,
    arm64Default,
    default:
      typeof value.default === 'string' ||
      typeof value.default === 'number' ||
      typeof value.default === 'boolean'
        ? value.default
        : undefined,
    options,
  };
}

export function parseThirdPartyServiceCatalog(source: string): ThirdPartyService[] {
  const parsed = yaml.load(source);
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.services)) {
    throw new Error('Third-party service catalogue must contain version: 1 and a services list.');
  }
  const ids = new Set<string>();
  const composeIds = new Set<string>();
  return parsed.services.map(value => {
    if (!isRecord(value)) throw new Error('Third-party service entry must be an object.');
    const id = asString(value.id, 'Third-party service id');
    if (RESERVED_SERVICE_IDS.has(id)) throw new Error(`Service id '${id}' is reserved by BaSyx.`);
    if (ids.has(id)) throw new Error(`Duplicate third-party service id '${id}'.`);
    ids.add(id);
    if (!isRecord(value.compose) || Object.keys(value.compose).length === 0) {
      throw new Error(`Service '${id}' must define at least one Compose service.`);
    }
    const compose = Object.fromEntries(
      Object.entries(value.compose).map(([composeId, service]) => {
        if (RESERVED_SERVICE_IDS.has(composeId)) {
          throw new Error(`Compose service id '${composeId}' is reserved by BaSyx.`);
        }
        if (composeIds.has(composeId)) {
          throw new Error(`Duplicate Compose service id '${composeId}'.`);
        }
        composeIds.add(composeId);
        if (!isRecord(service) || typeof service.image !== 'string') {
          throw new Error(`Compose service '${composeId}' for ${id} requires an image.`);
        }
        return [composeId, cloneCompose(service) as ComposeService];
      })
    );
    let unsupportedArchitectures: ThirdPartyService['unsupportedArchitectures'];
    if (value.unsupportedArchitectures !== undefined) {
      if (!isRecord(value.unsupportedArchitectures))
        throw new Error(
          `Unsupported architectures for ${id} must map CPU architectures to reasons.`
        );
      unsupportedArchitectures = {};
      for (const [architecture, reason] of Object.entries(value.unsupportedArchitectures)) {
        if (architecture !== 'amd64' && architecture !== 'arm64')
          throw new Error(`Unsupported CPU architecture '${architecture}' for ${id}.`);
        unsupportedArchitectures[architecture] = asString(reason, `Architecture reason for ${id}`);
      }
    }
    const configuration = Array.isArray(value.configuration)
      ? value.configuration.map(field => parseField(field, id))
      : [];
    configuration.forEach(field => {
      if (!field.environment) return;
      const target =
        field.service || (Object.keys(compose).length === 1 ? Object.keys(compose)[0] : undefined);
      if (!target || !Object.hasOwn(compose, target))
        throw new Error(
          `Environment field '${field.key}' for ${id} requires a valid target service.`
        );
      field.service = target;
    });
    return {
      id,
      name: asString(value.name, `Service name for ${id}`),
      description: asString(value.description, `Service description for ${id}`),
      tags: Array.isArray(value.tags) ? value.tags.map(tag => asString(tag, `Tag for ${id}`)) : [],
      compose,
      unsupportedArchitectures,
      legacyComposeIds: Array.isArray(value.legacyComposeIds)
        ? value.legacyComposeIds.map(legacyId => {
            const id = asString(legacyId, `Legacy Compose id for ${value.id}`);
            if (RESERVED_SERVICE_IDS.has(id))
              throw new Error(`Compose service id '${id}' is reserved by BaSyx.`);
            return id;
          })
        : undefined,
      configuration,
    };
  });
}

export async function loadThirdPartyServiceCatalog(): Promise<ThirdPartyService[]> {
  const response = await fetch('/third-party-services.yaml');
  if (!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
  return parseThirdPartyServiceCatalog(await response.text());
}

export function thirdPartyManagedServiceIds(services: ThirdPartyService[]): string[] {
  return [
    ...new Set(
      services.flatMap(service => [
        ...Object.keys(service.compose),
        ...(service.legacyComposeIds || []),
      ])
    ),
  ];
}

export function thirdPartyFieldError(
  field: ThirdPartyServiceField,
  value: ThirdPartyValue
): string | undefined {
  if (field.required && (value === undefined || value === false || String(value).trim() === ''))
    return 'Required';
  if (
    field.minLength &&
    value !== undefined &&
    value !== '' &&
    String(value).length < field.minLength
  )
    return `Use at least ${field.minLength} characters.`;
  return undefined;
}

export function buildThirdPartyServiceCompose(
  service: ThirdPartyService,
  values: Record<string, string | number | boolean | undefined>
): Record<string, ComposeService> {
  // Render catalogue-local settings without exposing every setting to every container.
  const render = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(
        /{{\s*config\.([\w]+)(\s*\|\s*connectionString)?\s*}}/g,
        (_match, key: string, connectionString: string | undefined) => {
          const field = service.configuration.find(candidate => candidate.key === key);
          if (!field) throw new Error(`Unknown configuration field '${key}' for ${service.id}.`);
          let setting = String(values[key] ?? field.default ?? '');
          if (connectionString) setting = `"${setting.replaceAll('"', '""')}"`;
          return setting.replaceAll('$', () => '$$');
        }
      );
    }
    if (Array.isArray(value)) return value.map(render);
    if (isRecord(value))
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)]));
    return value;
  };
  const compose = render(service.compose) as Record<string, ComposeService>;
  Object.entries(compose).forEach(([id, composeService]) => {
    const environment = Object.fromEntries(
      service.configuration
        .filter(field => field.environment && (field.service || Object.keys(compose)[0]) === id)
        .map(field => [field.environment as string, values[field.key] ?? field.default])
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value).replaceAll('$', () => '$$')])
    );
    if (!Object.keys(environment).length) return;
    if (Array.isArray(composeService.environment)) {
      composeService.environment = [
        ...composeService.environment.filter(
          entry => !Object.hasOwn(environment, entry.split('=')[0]!)
        ),
        ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      ];
    } else composeService.environment = { ...composeService.environment, ...environment };
  });
  return compose;
}

export function defaultThirdPartyValues(
  service: ThirdPartyService,
  architecture: ClientArchitecture = 'unknown'
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    service.configuration
      .filter(field => field.default !== undefined)
      .map(field => [
        field.key,
        architecture === 'arm64' && field.arm64Default !== undefined
          ? field.arm64Default
          : (field.default as string | number | boolean),
      ])
  );
}

/** Initialize once on selection/restoration, never while rendering Compose. */
export function initializeThirdPartyValues(
  service: ThirdPartyService,
  previous: Record<string, ThirdPartyValue> = {},
  architecture: ClientArchitecture = 'unknown'
): Record<string, string | number | boolean> {
  const values = Object.fromEntries(
    Object.entries({ ...defaultThirdPartyValues(service, architecture), ...previous }).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined
    )
  );
  service.configuration.forEach(field => {
    if (
      !field.generate ||
      (values[field.key] !== undefined &&
        values[field.key] !== '' &&
        !thirdPartyFieldError(field, values[field.key]))
    )
      return;
    if (!globalThis.crypto?.getRandomValues)
      throw new Error('Secure random generation is unavailable.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    values[field.key] =
      field.generate === 'hex-32'
        ? Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
        : btoa(String.fromCharCode(...bytes));
  });
  return values;
}

export function thirdPartyValuesForArchitecture(
  service: ThirdPartyService,
  values: Record<string, ThirdPartyValue>,
  architecture: 'amd64' | 'arm64'
): Record<string, ThirdPartyValue> {
  const result = { ...defaultThirdPartyValues(service, architecture), ...values };
  service.configuration.forEach(field => {
    if (
      field.arm64Default !== undefined &&
      (values[field.key] === undefined ||
        values[field.key] === field.default ||
        values[field.key] === field.arm64Default)
    )
      result[field.key] = architecture === 'arm64' ? field.arm64Default : field.default;
  });
  return result;
}

export function thirdPartyArchitectureError(
  service: ThirdPartyService,
  architecture: ClientArchitecture
): string | undefined {
  const reason =
    architecture === 'unknown' ? undefined : service.unsupportedArchitectures?.[architecture];
  return reason ? `Unavailable on ${architecture.toUpperCase()} — ${reason}` : undefined;
}

/** Validate persisted inputs as well as the actual Compose output before export. */
export function validateThirdPartyServices(
  services: ThirdPartyService[],
  selections: Array<{ id: string; values: Record<string, ThirdPartyValue> }>,
  compose: Record<string, ComposeService>,
  architecture: ClientArchitecture = 'unknown'
): string[] {
  const errors = findComposePortConflicts(compose);
  const managed = new Set(thirdPartyManagedServiceIds(services));
  const selectedIds = new Set(
    selections.flatMap(selection =>
      Object.keys(services.find(service => service.id === selection.id)?.compose || {})
    )
  );
  const base = Object.fromEntries(
    Object.entries(compose).filter(([id]) => !managed.has(id) || selectedIds.has(id))
  );
  const resolution = resolveThirdPartyServiceReferences(
    services,
    Object.fromEntries(selections.map(selection => [selection.id, selection.values])),
    base
  );
  errors.push(...resolution.errors);
  selections.forEach(selection => {
    const service = services.find(service => service.id === selection.id);
    if (!service) {
      errors.push(`Unknown additional service '${selection.id}'.`);
      return;
    }
    const architectureError = thirdPartyArchitectureError(service, architecture);
    if (architectureError) errors.push(`${service.name}: ${architectureError}`);
    service.configuration.forEach(field => {
      const error = thirdPartyFieldError(field, resolution.values[service.id]?.[field.key]);
      if (error) errors.push(`${service.name}: ${field.label} — ${error}`);
    });
    Object.keys(service.compose).forEach(id => {
      if (!compose[id])
        errors.push(
          `${service.name}: container '${id}' is missing. Reconfigure Additional Services.`
        );
    });
  });
  return [...new Set(errors)];
}

const PLACEHOLDER_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

function readPort(service: ComposeService | undefined, indexFromEnd: number): string | undefined {
  const ports = service?.ports;
  if (!Array.isArray(ports) || typeof ports[0] !== 'string') return undefined;
  return ports[0]
    .split(':')
    .at(indexFromEnd)
    ?.replace(/\/(tcp|udp|sctp)$/, '');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readEnvironmentValue(
  service: ComposeService | undefined,
  key: string
): string | undefined {
  const environment = service?.environment;
  if (Array.isArray(environment)) {
    const entry = environment.find(
      candidate => typeof candidate === 'string' && candidate.startsWith(`${key}=`)
    );
    return typeof entry === 'string' ? entry.slice(key.length + 1) : undefined;
  }
  return isRecord(environment) ? readString(environment[key]) : undefined;
}

/**
 * Resolves {{ services.<id>.<property> }} placeholders in selected third-party settings.
 * Catalogue service ids alias the first Compose service declared by that entry.
 */
export function resolveThirdPartyServiceReferences(
  services: ThirdPartyService[],
  selectedValues: Record<string, Record<string, ThirdPartyValue>>,
  baseCompose: Record<string, ComposeService> = {}
): ThirdPartyReferenceResolution {
  const errors = new Set<string>();
  const selectedServices = services.filter(service => service.id in selectedValues);
  const selectedById = new Map(selectedServices.map(service => [service.id, service]));
  const composeById: Record<string, ComposeService> = { ...cloneCompose(baseCompose) };
  const aliases = new Map<string, string>();

  selectedServices.forEach(service => {
    const composeIds = Object.keys(service.compose);
    if (composeIds[0]) aliases.set(service.id, composeIds[0]);
    Object.entries(service.compose).forEach(([id, template]) => {
      composeById[id] = { ...cloneCompose(template), ...cloneCompose(baseCompose[id] || {}) };
    });
  });

  const resolvedValues: Record<string, Record<string, ThirdPartyValue>> = {};
  const resolving = new Set<string>();

  const resolveConfigValue = (serviceId: string, key: string): ThirdPartyValue => {
    const nodeId = `${serviceId}.${key}`;
    if (resolvedValues[serviceId] && key in resolvedValues[serviceId]) {
      return resolvedValues[serviceId][key];
    }
    if (resolving.has(nodeId)) {
      errors.add(`Circular service reference detected at '${nodeId}'.`);
      return undefined;
    }

    const service = selectedById.get(serviceId);
    const field = service?.configuration.find(candidate => candidate.key === key);
    if (!service || !field) {
      errors.add(`Configuration reference '${nodeId}' does not exist on a selected service.`);
      return undefined;
    }

    resolving.add(nodeId);
    const raw = selectedValues[serviceId]?.[key] ?? field.default;
    const resolved = typeof raw === 'string' ? resolveText(raw, nodeId) : raw;
    resolving.delete(nodeId);
    (resolvedValues[serviceId] ||= {})[key] = resolved;
    return resolved;
  };

  const resolveReference = (reference: string, source: string): string | undefined => {
    const parts = reference.trim().split('.');
    if (parts[0] !== 'services' || parts.length < 3) {
      errors.add(`Invalid placeholder '{{ ${reference} }}' in '${source}'.`);
      return undefined;
    }
    const targetId = parts[1];
    if (!targetId) {
      errors.add(`Invalid placeholder '{{ ${reference} }}' in '${source}'.`);
      return undefined;
    }
    if (parts[2] === 'config') {
      const key = parts.slice(3).join('.');
      if (!key) {
        errors.add(`Invalid configuration reference '{{ ${reference} }}' in '${source}'.`);
        return undefined;
      }
      const owner =
        selectedById.get(targetId) ||
        selectedServices.find(service => Object.hasOwn(service.compose, targetId));
      const field = owner?.configuration.find(
        field => field.key === key || field.environment === key
      );
      if (isSensitiveKey(key) || field?.type === 'password') {
        errors.add(`Sensitive configuration reference '${targetId}.${key}' is not allowed.`);
        return undefined;
      }
      if (selectedById.has(targetId)) {
        const value = resolveConfigValue(targetId, key);
        return value === undefined ? undefined : String(value);
      }

      const composeId = aliases.get(targetId) || targetId;
      const value = readEnvironmentValue(composeById[composeId], key);
      if (value !== undefined) return value;

      errors.add(
        `Configuration reference '${targetId}.${key}' does not exist on a selected service.`
      );
      return undefined;
    }

    const composeId = aliases.get(targetId) || targetId;
    const target = composeById[composeId];
    if (!target) {
      errors.add(`Service '${targetId}' referenced by '${source}' is not selected.`);
      return undefined;
    }

    switch (parts[2]) {
      case 'host':
        return composeId;
      case 'port':
        return readPort(target, -1);
      case 'externalPort':
        return readPort(target, -2);
      case 'containerName':
        return readString(target.container_name) || composeId;
      case 'image':
        return readString(target.image);
      default:
        errors.add(`Unknown service property '${parts[2]}' in '{{ ${reference} }}'.`);
        return undefined;
    }
  };

  const resolveText = (value: string, source: string): string =>
    value.replace(PLACEHOLDER_PATTERN, (_placeholder, rawReference: string) => {
      const resolved = resolveReference(rawReference, source);
      return resolved === undefined ? '' : resolved;
    });

  selectedServices.forEach(service => {
    service.configuration.forEach(field => {
      resolveConfigValue(service.id, field.key);
    });
  });

  return { values: resolvedValues, errors: [...errors] };
}

// Utilities
import * as yaml from 'js-yaml';
import { defineStore } from 'pinia';
import { readServiceEnvironment } from '@/utils/dockerEnvironment';
import {
  buildAasEnvironmentExternalUrl,
  buildExternalServiceUrl,
  DEFAULT_AAS_ENVIRONMENT_EXTERNAL_PORT,
  DEFAULT_AAS_UI_EXTERNAL_PORT,
  DEFAULT_EXTERNAL_BASE_URL,
  getExplicitUrlPort,
  getUrlPath,
  joinBaseUrl,
  normalizeExternalBaseUrl,
  replaceExplicitUrlPort,
  replaceUrlPath,
} from '@/utils/externalUrls';
import { DEFAULT_POLICY, defaultTrustList } from '@/utils/securitySetup';
import { getHttpOrigin, parseTrustedOrigin } from '@/utils/trustedOrigins';

interface ContainerPort {
  id: string;
  port: number | undefined;
}

interface ContainerName {
  id: string;
  name: string | undefined;
}

interface ContextPath {
  id: string;
  contextPath: string | undefined;
}

interface BasyxConfigChild {
  id: string;
  title: string;
  type: string;
}

interface BasyxConfigItem {
  id: string;
  title: string;
  children: BasyxConfigChild[];
}

interface ConfigObject {
  name?: string;
  value?: string | Record<string, unknown>;
}

interface ManagedInfluxDbOrigin {
  infrastructureKey: string;
  origin: string;
}

export interface ExternalInfluxSettings {
  url: string;
  org: string;
  bucket: string;
  token: string;
}

export interface ThirdPartyServiceSelection {
  id: string;
  values: Record<string, string | number | boolean>;
}

interface DockerComposeService {
  ports?: string[];
  environment?: Record<string, string> | string[];
}

type Environment = Record<string, string> | string[];

export interface SerializableStarterState {
  registryIntegration: boolean;
  discoveryIntegration: boolean;
  externalBaseUrl: string;
  mqtt: boolean;
  timeSeriesData: boolean;
  includeTelegraf?: boolean;
  includeLocalInfluxDb?: boolean;
  externalInfluxSettings?: ExternalInfluxSettings;
  userInterface: boolean;
  dashboard: boolean;
  aasDiscovery: boolean;
  syncBranding: boolean;
  customColor: string;
  lightPrimaryColor: string;
  darkPrimaryColor: string;
  containerPorts: ContainerPort[];
  containerNames: ContainerName[];
  contextPathes: ContextPath[];
  basyxConfig: BasyxConfigItem[];
  dockerComposeConfig?: ConfigObject;
  basyxInfraConfig?: ConfigObject;
  managedInfluxDbOrigin?: ManagedInfluxDbOrigin;
  localInfluxDbOriginOptOutKey?: string;
  thirdPartyServices?: ThirdPartyServiceSelection[];
  thirdPartyArchitecture?: 'amd64' | 'arm64';
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isConfigObject(value: unknown): value is ConfigObject {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const config = value as ConfigObject;
  const hasValidName = config.name === undefined || typeof config.name === 'string';
  const hasValidValue =
    config.value === undefined ||
    typeof config.value === 'string' ||
    (typeof config.value === 'object' && config.value !== null);
  return hasValidName && hasValidValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDockerComposeServices(
  config: ConfigObject | undefined
): Record<string, unknown> | undefined {
  return isRecord(config?.value) && isRecord(config.value.services)
    ? config.value.services
    : undefined;
}

function hasLocalInfluxDb(config: ConfigObject | undefined): boolean {
  return isRecord(getDockerComposeServices(config)?.influxdb);
}

function hasTelegraf(config: ConfigObject | undefined): boolean {
  return isRecord(getDockerComposeServices(config)?.telegraf);
}

function readExternalInfluxSettings(
  config: ConfigObject | undefined
): Partial<ExternalInfluxSettings> | undefined {
  if (!hasTelegraf(config) || hasLocalInfluxDb(config)) {
    return undefined;
  }
  const environment = readServiceEnvironment(config?.value, 'telegraf');
  return {
    url: environment.INFLUX_URL,
    org: environment.INFLUX_ORG,
    bucket: environment.INFLUX_BUCKET,
    token: environment.INFLUX_TOKEN,
  };
}

function isExternalInfluxSettings(value: unknown): value is Partial<ExternalInfluxSettings> {
  return (
    isRecord(value) &&
    ['url', 'org', 'bucket', 'token'].every(
      key => value[key] === undefined || typeof value[key] === 'string'
    )
  );
}

function getLocalInfluxDbOrigin(
  enabled: boolean,
  externalBaseUrl: string,
  containerPorts: ContainerPort[],
  dockerComposeConfig: ConfigObject | undefined
): string | undefined {
  if (!enabled || !hasLocalInfluxDb(dockerComposeConfig)) {
    return undefined;
  }

  const influxPort = getContainerPortValue(containerPorts, 'influxdb') ?? 8086;
  const browserUrl = buildExternalServiceUrl(externalBaseUrl, influxPort);
  try {
    const url = new URL(browserUrl);
    url.protocol = 'http:';
    url.port = String(influxPort);
    return getHttpOrigin(url.toString()) ?? undefined;
  } catch {
    return undefined;
  }
}

function getDefaultInfrastructureKey(config: ConfigObject | undefined): string | undefined {
  if (!isRecord(config?.value) || !isRecord(config.value.infrastructures)) {
    return undefined;
  }
  const defaultKey = config.value.infrastructures.default;
  return typeof defaultKey === 'string' ? defaultKey : undefined;
}

function getInfrastructureTrustedOrigins(
  config: ConfigObject | undefined,
  infrastructureKey: string
): unknown[] | undefined {
  if (!isRecord(config?.value) || !isRecord(config.value.infrastructures)) {
    return undefined;
  }
  const infrastructure = config.value.infrastructures[infrastructureKey];
  if (!isRecord(infrastructure)) {
    return undefined;
  }
  return Array.isArray(infrastructure.trustedOrigins) ? infrastructure.trustedOrigins : [];
}

function withInfrastructureTrustedOrigins(
  config: ConfigObject | undefined,
  infrastructureKey: string,
  origins: unknown[]
): ConfigObject | undefined {
  if (!config) {
    return undefined;
  }
  const updated = cloneSerializable(config);
  if (!isRecord(updated.value) || !isRecord(updated.value.infrastructures)) {
    return undefined;
  }
  const infrastructure = updated.value.infrastructures[infrastructureKey];
  if (!isRecord(infrastructure)) {
    return undefined;
  }

  if (origins.length > 0) {
    infrastructure.trustedOrigins = origins;
  } else {
    delete infrastructure.trustedOrigins;
  }
  return updated;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function isContainerPortArray(value: unknown): value is ContainerPort[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        (item.port === undefined || typeof item.port === 'number')
    )
  );
}

function isContainerNameArray(value: unknown): value is ContainerName[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        (item.name === undefined || typeof item.name === 'string')
    )
  );
}

function isContextPathArray(value: unknown): value is ContextPath[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        (item.contextPath === undefined || typeof item.contextPath === 'string')
    )
  );
}

function isThirdPartyServiceSelectionArray(value: unknown): value is ThirdPartyServiceSelection[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        isRecord(item.values) &&
        Object.values(item.values).every(
          value =>
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        )
    )
  );
}

function isBasyxConfigArray(value: unknown): value is BasyxConfigItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        Array.isArray(item.children) &&
        item.children.every(
          (child: unknown) =>
            isRecord(child) &&
            typeof child.id === 'string' &&
            typeof child.title === 'string' &&
            typeof child.type === 'string'
        )
    )
  );
}

function setOrReplaceEnvVar(env: string[], key: string, value: string): void {
  const prefix = `${key}=`;
  const idx = env.findIndex(item => item.startsWith(prefix));
  if (idx >= 0) {
    env[idx] = `${key}=${value}`;
  } else {
    env.push(`${key}=${value}`);
  }
}

function setEnvironmentValue(environment: Environment, key: string, value: string): void {
  if (Array.isArray(environment)) {
    setOrReplaceEnvVar(environment, key, value);
  } else {
    environment[key] = value;
  }
}

function removeEnvironmentKeys(environment: Environment, keys: string[]): Environment {
  if (Array.isArray(environment)) {
    return environment.filter(entry => !keys.includes(entry.split('=')[0] || ''));
  }

  return Object.fromEntries(Object.entries(environment).filter(([key]) => !keys.includes(key)));
}

function mergeEnvironmentDefaults(
  defaults: Environment | undefined,
  existing: Environment | undefined
): Environment | undefined {
  if (!existing) {
    return defaults ? cloneSerializable(defaults) : undefined;
  }
  if (!defaults) {
    return existing;
  }

  if (Array.isArray(existing)) {
    const merged = [...existing];
    const existingKeys = new Set(
      existing.map(entry => entry.slice(0, entry.indexOf('='))).filter(Boolean)
    );
    const defaultEntries = Array.isArray(defaults)
      ? defaults
      : Object.entries(defaults).map(([key, value]) => `${key}=${value}`);
    defaultEntries.forEach(entry => {
      const separator = entry.indexOf('=');
      const key = separator >= 0 ? entry.slice(0, separator) : entry;
      if (key && !existingKeys.has(key)) {
        merged.push(entry);
        existingKeys.add(key);
      }
    });
    return merged;
  }

  const merged = { ...existing };
  const defaultEntries = Array.isArray(defaults) ? readEnvironmentEntries(defaults) : defaults;
  Object.entries(defaultEntries).forEach(([key, value]) => {
    if (!(key in merged)) {
      merged[key] = value;
    }
  });
  return merged;
}

function readEnvironmentEntries(environment: string[]): Record<string, string> {
  return environment.reduce<Record<string, string>>((result, entry) => {
    const separator = entry.indexOf('=');
    if (separator >= 0) {
      result[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
    return result;
  }, {});
}

const BASYX_GO_IMAGE_REPOSITORIES = {
  'aas-environment': 'eclipsebasyx/aasenvironment-go',
  basyx_configuration: 'eclipsebasyx/basyxconfigurationservice-go',
} as const;

type BasyxGoServiceName = keyof typeof BASYX_GO_IMAGE_REPOSITORIES;

function getBasyxGoImageTag(
  config: ConfigObject | undefined,
  serviceName: BasyxGoServiceName
): string {
  if (!config || !isRecord(config.value) || !isRecord(config.value.services)) return '';
  const service = config.value.services[serviceName];
  if (!isRecord(service) || typeof service.image !== 'string') return '';
  const separator = service.image.lastIndexOf(':');
  return separator > service.image.lastIndexOf('/') ? service.image.slice(separator + 1) : '';
}

function syncBasyxGoImageTag(config: ConfigObject, source: BasyxGoServiceName): ConfigObject {
  const updated = cloneSerializable(config);
  if (!isRecord(updated.value) || !isRecord(updated.value.services)) return updated;
  const services = updated.value.services;
  const tag = getBasyxGoImageTag(updated, source);
  if (!tag) return updated;

  for (const [name, repository] of Object.entries(BASYX_GO_IMAGE_REPOSITORIES)) {
    const service = services[name];
    if (!isRecord(service)) continue;
    const image = typeof service.image === 'string' ? service.image : '';
    const separator = image.lastIndexOf(':');
    const existingRepository =
      separator > image.lastIndexOf('/') ? image.slice(0, separator) : image;
    service.image = `${existingRepository || repository}:${tag}`;
  }
  return updated;
}

function mergeDockerComposeConfig(defaults: ConfigObject, existing: ConfigObject): ConfigObject {
  if (!isRecord(defaults.value) || !isRecord(existing.value)) {
    return cloneSerializable(existing);
  }

  const defaultServices = isRecord(defaults.value.services) ? defaults.value.services : {};
  const existingServices = isRecord(existing.value.services) ? existing.value.services : {};
  const services: Record<string, unknown> = { ...existingServices };
  const externalDatabase =
    !('db' in existingServices) && isRecord(existingServices['aas-environment']);

  Object.entries(defaultServices).forEach(([serviceName, defaultValue]) => {
    if (serviceName === 'db' && externalDatabase) return;
    if (!isRecord(defaultValue)) {
      if (!(serviceName in services)) {
        services[serviceName] = cloneSerializable(defaultValue);
      }
      return;
    }

    const existingValue = services[serviceName];
    if (!isRecord(existingValue)) {
      services[serviceName] = cloneSerializable(defaultValue);
      return;
    }

    const mergedService: Record<string, unknown> = { ...defaultValue, ...existingValue };
    if ('environment' in defaultValue || 'environment' in existingValue) {
      let defaultEnvironment =
        isStringRecord(defaultValue.environment) || Array.isArray(defaultValue.environment)
          ? defaultValue.environment
          : undefined;
      if (externalDatabase && defaultEnvironment) {
        defaultEnvironment = removeEnvironmentKeys(defaultEnvironment, ['POSTGRES_PASSWORD']);
      }
      const existingEnvironment =
        isStringRecord(existingValue.environment) || Array.isArray(existingValue.environment)
          ? existingValue.environment
          : undefined;
      mergedService.environment = mergeEnvironmentDefaults(defaultEnvironment, existingEnvironment);
    }
    services[serviceName] = mergedService;
  });

  if (externalDatabase) {
    for (const serviceName of ['aas-environment', 'basyx_configuration']) {
      const service = services[serviceName];
      if (!isRecord(service)) continue;
      const dependencies = isRecord(service.depends_on) ? { ...service.depends_on } : {};
      delete dependencies.db;
      services[serviceName] = { ...service, depends_on: dependencies };
    }
  }

  if (isRecord(services.keycloak)) {
    const keycloak = services.keycloak;
    const networks = isRecord(keycloak.networks) ? keycloak.networks : {};
    services.keycloak = {
      ...keycloak,
      networks: { ...networks, default: { aliases: ['keycloak.localhost'] } },
    };
    for (const serviceName of ['aas-environment', 'aas-ui']) {
      const service = services[serviceName];
      if (!isRecord(service) || !Array.isArray(service.extra_hosts)) continue;
      const extraHosts = service.extra_hosts.filter(
        host => typeof host !== 'string' || !host.startsWith('keycloak.localhost:')
      );
      const updated = { ...service };
      if (extraHosts.length) updated.extra_hosts = extraHosts;
      else delete updated.extra_hosts;
      services[serviceName] = updated;
    }
  }

  // Shared links omit secrets. Restore only the fixed credentials of generated local
  // services; external credentials must still be supplied by the user.
  const db = services.db;
  const dbEnvironment = isRecord(db) ? db.environment : undefined;
  const dbEntries = Array.isArray(dbEnvironment)
    ? readEnvironmentEntries(dbEnvironment)
    : isStringRecord(dbEnvironment)
      ? dbEnvironment
      : {};
  const keycloak = services.keycloak;
  if (isRecord(keycloak) && isRecord(db) && dbEntries.POSTGRES_PASSWORD) {
    services.keycloak = {
      ...keycloak,
      environment: mergeEnvironmentDefaults(
        { KC_DB_PASSWORD: dbEntries.POSTGRES_PASSWORD },
        isStringRecord(keycloak.environment) || Array.isArray(keycloak.environment)
          ? keycloak.environment
          : undefined
      ),
    };
  }
  const rabbitmq = services.rabbitmq;
  if (isRecord(rabbitmq)) {
    services.rabbitmq = {
      ...rabbitmq,
      environment: mergeEnvironmentDefaults(
        { RABBITMQ_DEFAULT_PASS: 'basyx-demo' },
        isStringRecord(rabbitmq.environment) || Array.isArray(rabbitmq.environment)
          ? rabbitmq.environment
          : undefined
      ),
    };
    const aasEnvironment = services['aas-environment'];
    if (isRecord(aasEnvironment)) {
      services['aas-environment'] = {
        ...aasEnvironment,
        environment: mergeEnvironmentDefaults(
          { BASYX_EVENTING_AMQP_PASSWORD: 'basyx-demo' },
          isStringRecord(aasEnvironment.environment) || Array.isArray(aasEnvironment.environment)
            ? aasEnvironment.environment
            : undefined
        ),
      };
    }
  }

  return syncBasyxGoImageTag(
    {
      ...cloneSerializable(defaults),
      ...cloneSerializable(existing),
      value: {
        ...defaults.value,
        ...existing.value,
        services,
      },
    },
    'aas-environment'
  );
}

function mergeBasyxConfigDefaults(
  defaults: BasyxConfigItem[],
  existing: BasyxConfigItem[]
): BasyxConfigItem[] {
  const defaultIds = new Set(defaults.map(item => item.id));
  const mergedDefaults = defaults.map(defaultItem => {
    const existingItem = existing.find(item => item.id === defaultItem.id);
    if (!existingItem) {
      return cloneSerializable(defaultItem);
    }

    const existingChildIds = new Set(existingItem.children.map(child => child.id));
    return {
      ...cloneSerializable(defaultItem),
      ...cloneSerializable(existingItem),
      children: [
        ...cloneSerializable(existingItem.children),
        ...cloneSerializable(defaultItem.children).filter(child => !existingChildIds.has(child.id)),
      ],
    };
  });
  return [...mergedDefaults, ...existing.filter(item => !defaultIds.has(item.id))];
}

function getContainerPortValue(
  containerPorts: ContainerPort[],
  serviceName: string
): number | undefined {
  return containerPorts.find(item => item.id === serviceName)?.port;
}

function getContextPathValue(
  contextPathes: ContextPath[],
  serviceName: string
): string | undefined {
  return contextPathes.find(item => item.id === serviceName)?.contextPath;
}

function setDockerComposeServicePort(
  services: Record<string, DockerComposeService>,
  serviceName: string,
  port: number | undefined
): void {
  if (!port) {
    return;
  }

  const service = services[serviceName];
  if (!service?.ports || !Array.isArray(service.ports) || service.ports.length === 0) {
    return;
  }

  if (serviceName === 'aas-environment') {
    service.ports[0] = `${port}:${port}`;
    if (service.environment) {
      setEnvironmentValue(service.environment, 'SERVER_PORT', String(port));
    }
    return;
  }

  const currentMapping = service.ports[0];
  if (!currentMapping) {
    return;
  }
  const parts = currentMapping.split(':');
  const internal = parts.length >= 2 ? parts[1] : String(port);
  service.ports[0] = `${port}:${internal}`;
}

function setDockerComposeServiceContextPath(
  services: Record<string, DockerComposeService>,
  serviceName: string,
  contextPath: string | undefined
): void {
  const service = services[serviceName];
  if (!service) {
    return;
  }

  if (serviceName === 'aas-environment') {
    if (!service.environment) {
      service.environment = [];
    }
    if (contextPath) {
      setEnvironmentValue(service.environment, 'SERVER_CONTEXTPATH', contextPath);
    } else {
      service.environment = removeEnvironmentKeys(service.environment, ['SERVER_CONTEXTPATH']);
    }
  }

  if (serviceName === 'aas-ui') {
    if (!service.environment || Array.isArray(service.environment)) {
      service.environment = {};
    }
    if (contextPath) {
      service.environment.BASE_PATH = contextPath;
    } else {
      delete service.environment.BASE_PATH;
    }
  }
}

function createDefaultDockerComposeConfig(
  externalBaseUrl = DEFAULT_EXTERNAL_BASE_URL,
  aasEnvironmentExternalPort = DEFAULT_AAS_ENVIRONMENT_EXTERNAL_PORT,
  aasEnvironmentContextPath?: string
): ConfigObject {
  const aasEnvironmentExternalUrl = buildAasEnvironmentExternalUrl(
    externalBaseUrl,
    aasEnvironmentExternalPort,
    aasEnvironmentContextPath
  );
  return {
    name: 'docker-compose.yml',
    value: {
      services: {
        'aas-environment': {
          container_name: 'aas-environment',
          image: 'eclipsebasyx/aasenvironment-go:latest',
          pull_policy: 'always',
          ports: ['8082:8082'],
          environment: [
            'LOGGING_FORMAT=text',
            'LOGGING_LEVEL=info',
            'SERVER_PORT=8082',
            'SERVER_CACHEENABLED=false',
            'SERVER_STRICTVERIFICATION=permissive',
            'SERVER_VERIFICATIONENDPOINTAVAILABLE=true',
            'SERVER_READ_HEADER_TIMEOUT_SECONDS=15',
            'SERVER_READ_TIMEOUT_SECONDS=300',
            'SERVER_WRITE_TIMEOUT_SECONDS=300',
            'SERVER_IDLE_TIMEOUT_SECONDS=60',
            'SERVER_SHUTDOWN_TIMEOUT_SECONDS=10',
            'SERVER_PAGINATION_DEFAULT_LIMIT=100',
            'SERVER_PAGINATION_MAX_LIMIT=1000',
            'CORS_ALLOWEDORIGINS=*',
            'CORS_ALLOWEDHEADERS=*',
            'CORS_ALLOWCREDENTIALS=true',
            'CORS_ALLOWEDMETHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'POSTGRES_HOST=db',
            'POSTGRES_PORT=5432',
            'POSTGRES_USER=admin',
            'POSTGRES_PASSWORD=admin123',
            'POSTGRES_DBNAME=basyxTestDB',
            'POSTGRES_SSLMODE=disable',
            'POSTGRES_CONNECTTIMEOUTSECONDS=0',
            'POSTGRES_MAXOPENCONNECTIONS=50',
            'POSTGRES_MAXIDLECONNECTIONS=25',
            'POSTGRES_CONNMAXLIFETIMEMINUTES=5',
            'POSTGRES_CONNMAXIDLETIMEMINUTES=0',
            'JWS_PRIVATEKEYPATH=/app/rsa-key.pem',
            'ABAC_ENABLED=false',
            'GENERAL_ENABLEIMPLICITCASTS=true',
            'GENERAL_ENABLEDESCRIPTORDEBUG=false',
            'GENERAL_ENABLECUSTOMMIDDLEWAREHEADERINJECTION=false',
            'GENERAL_SUPPORTSSINGULARSUPPLEMENTALSEMANTICID=false',
            'GENERAL_TRUSTPROXYHEADERS=false',
            'GENERAL_UPLOADMAXSIZEBYTES=134217728',
            'GENERAL_DELEGATEDOPERATIONRESPONSEMAXSIZEBYTES=1048576',
            'GENERAL_AASXMAXPARTCOUNT=10000',
            'GENERAL_AASXMAXOPCMETADATASIZEBYTES=16777216',
            'GENERAL_AASXMAXPARTEXPANDEDSIZEBYTES=134217728',
            'GENERAL_AASXMAXTOTALEXPANDEDSIZEBYTES=536870912',
            'GENERAL_AASXMAXTHUMBNAILSIZEBYTES=16777216',
            'GENERAL_BULK_BATCH_LIMIT=1000',
            'GENERAL_AASREGISTRYINTEGRATION=true',
            'GENERAL_SUBMODELREGISTRYINTEGRATION=true',
            'GENERAL_DISCOVERYINTEGRATION=true',
            `GENERAL_EXTERNALURL=${aasEnvironmentExternalUrl}`,
            'GENERAL_AAS_PRECONFIG_PATHS=/app/preconfiguration',
            'BASYX_HISTORY_MODE=off',
            'BASYX_HISTORY_RETENTION_DAYS=0',
            'BASYX_HISTORY_FULL_SNAPSHOT_INTERVAL=1',
            'BASYX_HISTORY_IMMUTABILITY=none',
            'BASYX_AUDIT_IDENTITY_MODE=none',
            'BASYX_HISTORY_EVIDENCE_ENABLED=false',
            'BASYX_HISTORY_INTEGRITY_ANCHOR_PROVIDER=none',
            'BASYX_EVENTING_ENABLED=false',
            'BASYX_EVENTING_FORMAT=cloudevents',
            'BASYX_EVENTING_OUTBOX_ENABLED=false',
            'BASYX_EVENTING_TOPIC_PREFIX=basyx',
            'BASYX_EVENTING_FEED_ENABLED=false',
            'OTEL_TRACES_EXPORTER=none',
            'OTEL_METRICS_EXPORTER=none',
          ],
          volumes: ['./basyx/rsa-key.pem:/app/rsa-key.pem:ro', './aas:/app/preconfiguration:ro'],
          depends_on: {
            basyx_configuration: {
              condition: 'service_completed_successfully',
            },
          },
          restart: 'unless-stopped',
        },
        db: {
          container_name: 'postgres_db',
          image: 'postgres:18',
          environment: {
            POSTGRES_USER: 'admin',
            POSTGRES_PASSWORD: 'admin123',
            POSTGRES_DB: 'basyxTestDB',
          },
          command: ['postgres', '-c', 'listen_addresses=*'],
          healthcheck: {
            test: ['CMD-SHELL', 'pg_isready -U admin -d basyxTestDB'],
            interval: '10s',
            timeout: '5s',
            retries: 5,
          },
          restart: 'unless-stopped',
        },
        basyx_configuration: {
          container_name: 'basyx_configuration',
          image: 'eclipsebasyx/basyxconfigurationservice-go:latest',
          environment: [
            'POSTGRES_HOST=db',
            'POSTGRES_PORT=5432',
            'POSTGRES_USER=admin',
            'POSTGRES_PASSWORD=admin123',
            'POSTGRES_DBNAME=basyxTestDB',
            'POSTGRES_SSLMODE=disable',
            'POSTGRES_CONNECTTIMEOUTSECONDS=0',
            'POSTGRES_MAXOPENCONNECTIONS=50',
            'POSTGRES_MAXIDLECONNECTIONS=25',
            'POSTGRES_CONNMAXLIFETIMEMINUTES=5',
            'POSTGRES_CONNMAXIDLETIMEMINUTES=0',
          ],
          depends_on: {
            db: {
              condition: 'service_healthy',
            },
          },
        },
        'aas-ui': {
          container_name: 'aas-web-ui',
          image: 'eclipsebasyx/aas-gui:latest',
          pull_policy: 'always',
          ports: ['3000:3000'],
          environment: {
            ENDPOINT_CONFIG_AVAILABLE: 'false',
            ALLOW_EDITING: 'true',
            ALLOW_UPLOADING: 'true',
            ALLOW_LOGOUT: 'true',
            SM_VIEWER_EDITOR: 'true',
            START_PAGE_ROUTE_NAME: 'AASViewer',
          },
          volumes: ['./basyx-infra.yml:/basyx-infra.yml:ro'],
          depends_on: {
            'aas-environment': {
              condition: 'service_started',
            },
          },
          restart: 'unless-stopped',
        },
      },
    },
  };
}

function createDefaultInfraConfig(
  externalBaseUrl = DEFAULT_EXTERNAL_BASE_URL,
  aasEnvironmentExternalPort = DEFAULT_AAS_ENVIRONMENT_EXTERNAL_PORT,
  aasEnvironmentContextPath?: string
): ConfigObject {
  const aasEnvironmentExternalUrl = buildAasEnvironmentExternalUrl(
    externalBaseUrl,
    aasEnvironmentExternalPort,
    aasEnvironmentContextPath
  );
  return {
    name: 'basyx-infra.yml',
    value: {
      infrastructures: {
        default: 'infra1',
        infra1: {
          name: 'Minimal BaSyx',
          components: {
            aasDiscovery: {
              baseUrl: joinBaseUrl(aasEnvironmentExternalUrl, 'lookup/shells'),
            },
            aasRegistry: {
              baseUrl: joinBaseUrl(aasEnvironmentExternalUrl, 'shell-descriptors'),
              hasDiscoveryIntegration: true,
            },
            submodelRegistry: {
              baseUrl: joinBaseUrl(aasEnvironmentExternalUrl, 'submodel-descriptors'),
            },
            aasRepository: {
              baseUrl: joinBaseUrl(aasEnvironmentExternalUrl, 'shells'),
              hasRegistryIntegration: true,
            },
            submodelRepository: {
              baseUrl: joinBaseUrl(aasEnvironmentExternalUrl, 'submodels'),
              hasRegistryIntegration: true,
            },
            conceptDescriptionRepository: {
              baseUrl: joinBaseUrl(aasEnvironmentExternalUrl, 'concept-descriptions'),
            },
          },
          security: {
            type: 'none',
          },
        },
      },
    },
  };
}

function initialState() {
  return {
    // feature toggles
    registryIntegration: true,
    discoveryIntegration: true,
    externalBaseUrl: DEFAULT_EXTERNAL_BASE_URL,
    mqtt: false,
    timeSeriesData: false,
    includeTelegraf: false,
    includeLocalInfluxDb: true,
    externalInfluxSettings: {
      url: '',
      org: 'basyx',
      bucket: 'basyx',
      token: '',
    } as ExternalInfluxSettings,
    userInterface: true,
    dashboard: false,
    aasDiscovery: true,
    syncBranding: false,

    // design/upload state
    customColor: '',
    lightPrimaryColor: '',
    darkPrimaryColor: '',
    appIcon: undefined as File | undefined,
    logo: undefined as File | undefined,
    logoLight: undefined as File | undefined,
    logoDark: undefined as File | undefined,
    telegrafConf: undefined as File | undefined,
    aasFiles: undefined as File[] | undefined,
    accessPolicyJson: DEFAULT_POLICY,
    trustListJson: defaultTrustList(),

    // editable docker settings
    containerPorts: [
      { id: 'aas-environment', port: DEFAULT_AAS_ENVIRONMENT_EXTERNAL_PORT as number | undefined },
      { id: 'aas-ui', port: DEFAULT_AAS_UI_EXTERNAL_PORT as number | undefined },
      { id: 'influxdb', port: 8086 as number | undefined },
    ] as ContainerPort[],
    containerNames: [
      { id: 'aas-environment', name: 'aas-environment' as string | undefined },
      { id: 'db', name: 'postgres_db' as string | undefined },
      { id: 'basyx_configuration', name: 'basyx_configuration' as string | undefined },
      { id: 'aas-ui', name: 'aas-web-ui' as string | undefined },
      { id: 'influxdb', name: 'influxdb' as string | undefined },
      { id: 'telegraf', name: 'telegraf' as string | undefined },
    ] as ContainerName[],
    contextPathes: [
      { id: 'aas-environment', contextPath: undefined as string | undefined },
      { id: 'aas-ui', contextPath: undefined as string | undefined },
    ] as ContextPath[],

    // right-side output tree
    basyxConfig: [
      {
        id: 'comp-aas-environment',
        title: 'AAS Environment',
        children: [
          {
            id: 'ovw-aas-environment-summary',
            title: 'Runtime & Endpoints',
            type: 'overview',
          },
          {
            id: 'ovw-aas-environment-history',
            title: 'History & Audit',
            type: 'overview',
          },
          {
            id: 'ovw-aas-environment-observability',
            title: 'Logging & OpenTelemetry',
            type: 'overview',
          },
          {
            id: 'ovw-aas-environment-integrations',
            title: 'Integrations',
            type: 'overview',
          },
          {
            id: 'ovw-aas-environment-security',
            title: 'Security',
            type: 'overview',
          },
          { id: 'cfg-aas-environment', title: 'Docker', type: 'config' },
        ],
      },
      {
        id: 'comp-postgres',
        title: 'PostgreSQL',
        children: [
          { id: 'ovw-postgres-summary', title: 'Database Settings', type: 'overview' },
          { id: 'cfg-postgres', title: 'Docker', type: 'config' },
        ],
      },
      {
        id: 'comp-basyx-configuration',
        title: 'Configuration Service',
        children: [
          {
            id: 'ovw-basyx-configuration-summary',
            title: 'Connection Settings',
            type: 'overview',
          },
          {
            id: 'cfg-basyx-configuration',
            title: 'Docker',
            type: 'config',
          },
        ],
      },
      {
        id: 'comp-aas-ui',
        title: 'AAS Web UI',
        children: [
          { id: 'ovw-aas-ui-summary', title: 'Runtime & Access', type: 'overview' },
          { id: 'ovw-aas-ui-behavior', title: 'Behavior Settings', type: 'overview' },
          { id: 'ovw-aas-ui-branding', title: 'Corporate Design', type: 'overview' },
          {
            id: 'ovw-aas-ui-infra',
            title: 'Backend Connections',
            type: 'overview',
          },
          { id: 'cfg-aas-ui', title: 'Docker', type: 'config' },
          { id: 'cfg-basyx-infra', title: 'Infrastructure Config', type: 'config' },
        ],
      },
    ] as BasyxConfigItem[],

    selectedOutput: undefined as BasyxConfigItem | undefined,
    selectedOutputConfig: undefined as ConfigObject | undefined,

    // generated files
    dockerComposeConfig: undefined as ConfigObject | undefined,
    basyxInfraConfig: undefined as ConfigObject | undefined,
    managedInfluxDbOrigin: undefined as ManagedInfluxDbOrigin | undefined,
    localInfluxDbOriginOptOutKey: undefined as string | undefined,
    localInfluxDbWasPresent: false,
    thirdPartyServices: [] as ThirdPartyServiceSelection[],
    thirdPartyArchitecture: undefined as 'amd64' | 'arm64' | undefined,

    // legacy config slots (kept to avoid breakage while migrating pages)
    aasEnvConfig: undefined as ConfigObject | undefined,
    aasRegistryConfig: undefined as ConfigObject | undefined,
    submodelRegistryConfig: undefined as ConfigObject | undefined,
    aasDiscoveryConfig: undefined as ConfigObject | undefined,
    dashboardConfig: undefined as ConfigObject | undefined,
  };
}

export const useAppStore = defineStore('app', {
  state: initialState,
  getters: {
    getRegistryIntegration: state => state.registryIntegration,
    getDiscoveryIntegration: state => state.discoveryIntegration,
    getExternalBaseUrl: state => state.externalBaseUrl,
    getEffectiveAasEnvironmentExternalUrl: state =>
      buildAasEnvironmentExternalUrl(
        state.externalBaseUrl,
        getContainerPortValue(state.containerPorts, 'aas-environment'),
        getContextPathValue(state.contextPathes, 'aas-environment')
      ),
    getAasWebUiExternalUrl: state =>
      buildExternalServiceUrl(
        state.externalBaseUrl,
        getContainerPortValue(state.containerPorts, 'aas-ui'),
        getContextPathValue(state.contextPathes, 'aas-ui')
      ),
    getConfiguredInfluxDbOrigin: state => {
      if (!state.timeSeriesData) {
        return undefined;
      }

      const services = getDockerComposeServices(state.dockerComposeConfig);

      if (isRecord(services?.influxdb)) {
        return getLocalInfluxDbOrigin(
          state.timeSeriesData,
          state.externalBaseUrl,
          state.containerPorts,
          state.dockerComposeConfig
        );
      }

      const influxUrl =
        state.externalInfluxSettings.url ||
        readServiceEnvironment(state.dockerComposeConfig?.value, 'telegraf').INFLUX_URL;
      return getHttpOrigin(influxUrl) ?? undefined;
    },
    getAasDiscovery: state => state.aasDiscovery,
    getMQTT: state => state.mqtt,
    getTimeSeriesData: state => state.timeSeriesData,
    getIncludeTelegraf: state => state.includeTelegraf,
    getIncludeLocalInfluxDb: state => state.includeLocalInfluxDb,
    getExternalInfluxSettings: state => state.externalInfluxSettings,
    getUserInterface: state => state.userInterface,
    getDashboard: state => state.dashboard,
    getSyncBranding: state => state.syncBranding,

    getPrimaryColor: state => state.customColor,
    getPrimaryLightColor: state => state.lightPrimaryColor,
    getPrimaryDarkColor: state => state.darkPrimaryColor,
    getAppIcon: state => state.appIcon,
    getLogo: state => state.logo,
    getLogoLight: state => state.logoLight,
    getLogoDark: state => state.logoDark,
    getTelegrafConf: state => state.telegrafConf,
    getAasFiles: state => state.aasFiles,
    getBasyxConfig: state => state.basyxConfig,
    getThirdPartyServices: state => state.thirdPartyServices,
    getSelectedOutput: state => state.selectedOutput,
    getSelectedOutputConfig: state => state.selectedOutputConfig,

    getDockerComposeConfigAsString: state => {
      const dockerComposeConfigObject = { ...state.dockerComposeConfig };
      const yamlDockerComposeString = yaml.dump(dockerComposeConfigObject.value);
      dockerComposeConfigObject.value = yamlDockerComposeString;
      return dockerComposeConfigObject;
    },
    getDockerComposeConfigService: state => (serviceName: string) => {
      const dockerComposeConfigObject = { ...state.dockerComposeConfig };
      if (
        dockerComposeConfigObject.value &&
        typeof dockerComposeConfigObject.value === 'object' &&
        'services' in dockerComposeConfigObject.value
      ) {
        const services = dockerComposeConfigObject.value.services as Record<string, unknown>;
        const service = services[serviceName];
        const servicesString = yaml.dump({ services: { [serviceName]: service } });
        dockerComposeConfigObject.value = servicesString;
      }
      return dockerComposeConfigObject;
    },
    getBasyxInfraConfigAsString: state => {
      const infraConfigObject = { ...state.basyxInfraConfig };
      const yamlInfraString = yaml.dump(infraConfigObject.value);
      infraConfigObject.value = yamlInfraString;
      return infraConfigObject;
    },

    // legacy getters
    getAasEnvConfigAsString: state => {
      const obj = { ...state.aasEnvConfig };
      if (obj.value && typeof obj.value === 'object') {
        let raw = '';
        for (const key in obj.value) {
          raw += `${key}=${obj.value[key]}\n`;
        }
        obj.value = raw;
      }
      return obj;
    },
    getAasRegistryConfigAsString: state => {
      const obj = { ...state.aasRegistryConfig };
      obj.value = yaml.dump(obj.value);
      return obj;
    },
    getSubmodelRegistryConfigAsString: state => {
      const obj = { ...state.submodelRegistryConfig };
      obj.value = yaml.dump(obj.value);
      return obj;
    },
    getAasDiscoveryConfigAsString: state => {
      const obj = { ...state.aasDiscoveryConfig };
      if (obj.value && typeof obj.value === 'object') {
        let raw = '';
        for (const key in obj.value) {
          raw += `${key}=${obj.value[key]}\n`;
        }
        obj.value = raw;
      }
      return obj;
    },
    getDashboardConfigAsString: state => {
      const obj = { ...state.dashboardConfig };
      obj.value = yaml.dump(obj.value);
      return obj;
    },

    getDockerComposeConfig: state => state.dockerComposeConfig,
    getBasyxInfraConfig: state => state.basyxInfraConfig,
    getAasEnvConfig: state => state.aasEnvConfig,
    getAasRegistryConfig: state => state.aasRegistryConfig,
    getSubmodelRegistryConfig: state => state.submodelRegistryConfig,
    getAasDiscoveryConfig: state => state.aasDiscoveryConfig,
    getDashboardConfig: state => state.dashboardConfig,
    getContainerPort: state => (serviceName: string) => {
      const port = state.containerPorts.find(item => item.id === serviceName);
      return port?.port;
    },
    getContainerName: state => (serviceName: string) => {
      const name = state.containerNames.find(item => item.id === serviceName);
      return name?.name;
    },
    getContextPath: state => (serviceName: string) => {
      const contextPath = state.contextPathes.find(item => item.id === serviceName);
      return contextPath?.contextPath;
    },
  },
  actions: {
    updateRegistryIntegration(value: boolean) {
      this.registryIntegration = value;
    },
    updateDiscoveryIntegration(value: boolean) {
      this.discoveryIntegration = value;
    },
    updateExternalBaseUrl(value: string) {
      this.externalBaseUrl = value;
      this.setContextPath('aas-environment', getUrlPath(value));
      const explicitPort = getExplicitUrlPort(value);
      if (explicitPort) {
        this.setContainerPort('aas-environment', explicitPort);
        return;
      }
      this.applyExternalBaseUrlToGeneratedConfigs();
    },
    updateAasDiscovery(value: boolean) {
      this.aasDiscovery = value;
    },
    updateMQTT(value: boolean) {
      this.mqtt = value;
    },
    updateTimeSeriesData(value: boolean) {
      this.timeSeriesData = value;
      this.syncManagedLocalInfluxDbOrigin();
    },
    updateIncludeTelegraf(value: boolean) {
      this.includeTelegraf = value;
    },
    updateIncludeLocalInfluxDb(value: boolean) {
      this.includeLocalInfluxDb = value;
    },
    updateExternalInfluxSettings(settings: ExternalInfluxSettings) {
      this.externalInfluxSettings = {
        url: settings.url.trim(),
        org: settings.org.trim(),
        bucket: settings.bucket.trim(),
        token: settings.token.trim(),
      };
    },
    updateUserInterface(value: boolean) {
      this.userInterface = value;
    },
    updateDashboard(value: boolean) {
      this.dashboard = value;
    },
    updateSyncBranding(value: boolean) {
      this.syncBranding = value;
    },

    setPrimaryColor(color: string) {
      this.customColor = color;
    },
    setPrimaryLightColor(color: string) {
      this.lightPrimaryColor = color;
    },
    setPrimaryDarkColor(color: string) {
      this.darkPrimaryColor = color;
    },
    setAppIcon(icon: File | undefined) {
      if (icon) {
        const oldFile = icon;
        const newFile = new File([oldFile], 'favicon.ico', { type: oldFile.type });
        this.appIcon = newFile;
      } else {
        this.appIcon = icon;
      }
    },
    setLogo(logo: File | undefined) {
      this.logo = logo;
    },
    setLogoLight(logo: File | undefined) {
      this.logoLight = logo;
    },
    setLogoDark(logo: File | undefined) {
      this.logoDark = logo;
    },
    setTelegrafConf(conf: File | undefined) {
      this.telegrafConf = conf;
    },
    setAasFiles(files: File[] | undefined) {
      this.aasFiles = files;
    },
    updateBasyxConfig(config: BasyxConfigItem[]) {
      this.basyxConfig = config;
    },

    selectOutput(output: BasyxConfigItem) {
      this.selectedOutput = output;
      this.selectedOutputConfig = undefined;
    },

    setDockerComposeConfig(config: ConfigObject) {
      const localInfluxDbCreated = hasLocalInfluxDb(config) && !this.localInfluxDbWasPresent;
      const legacyExternalSettings = readExternalInfluxSettings(config);
      const previousAasTag = getBasyxGoImageTag(this.dockerComposeConfig, 'aas-environment');
      const previousConfigTag = getBasyxGoImageTag(this.dockerComposeConfig, 'basyx_configuration');
      const aasTag = getBasyxGoImageTag(config, 'aas-environment');
      const configTag = getBasyxGoImageTag(config, 'basyx_configuration');
      const changedConfigOnly = configTag !== previousConfigTag && aasTag === previousAasTag;
      this.dockerComposeConfig = syncBasyxGoImageTag(
        config,
        changedConfigOnly ? 'basyx_configuration' : 'aas-environment'
      );
      this.localInfluxDbWasPresent = hasLocalInfluxDb(this.dockerComposeConfig);
      if (legacyExternalSettings) {
        this.externalInfluxSettings = {
          url: legacyExternalSettings.url ?? this.externalInfluxSettings.url,
          org: legacyExternalSettings.org ?? this.externalInfluxSettings.org,
          bucket: legacyExternalSettings.bucket ?? this.externalInfluxSettings.bucket,
          token: legacyExternalSettings.token ?? this.externalInfluxSettings.token,
        };
      }
      if (localInfluxDbCreated) {
        this.localInfluxDbOriginOptOutKey = undefined;
      }
      this.syncManagedLocalInfluxDbOrigin();
    },
    setThirdPartyServices(
      selections: ThirdPartyServiceSelection[],
      additions: Record<string, DockerComposeService>,
      managedServiceIds: string[]
    ) {
      const current = this.dockerComposeConfig;
      if (!current || !isRecord(current.value) || !isRecord(current.value.services)) return;
      const updated = cloneSerializable(current);
      if (!isRecord(updated.value) || !isRecord(updated.value.services)) return;
      const existing = updated.value.services as Record<string, DockerComposeService>;
      updated.value.services = {
        ...Object.fromEntries(
          Object.entries(existing).filter(([serviceId]) => !managedServiceIds.includes(serviceId))
        ),
        ...cloneSerializable(additions),
      };
      this.thirdPartyServices = cloneSerializable(selections);
      const thirdPartyOutput: BasyxConfigItem | undefined = Object.keys(additions).length
        ? {
            id: 'comp-third-party-services',
            title: 'Additional Services',
            children: Object.keys(additions).map(serviceId => ({
              id: `cfg-third-party-${serviceId}`,
              title: serviceId,
              type: 'config',
            })),
          }
        : undefined;
      this.basyxConfig = [
        ...this.basyxConfig.filter(item => item.id !== 'comp-third-party-services'),
        ...(thirdPartyOutput ? [thirdPartyOutput] : []),
      ];
      this.setDockerComposeConfig(updated);
    },
    setBasyxGoImageTag(serviceName: BasyxGoServiceName, tag: string) {
      if (!this.dockerComposeConfig) return;
      const config = cloneSerializable(this.dockerComposeConfig);
      if (!isRecord(config.value) || !isRecord(config.value.services)) return;
      const service = config.value.services[serviceName];
      if (!isRecord(service) || !tag.trim()) return;
      service.image = `${BASYX_GO_IMAGE_REPOSITORIES[serviceName]}:${tag.trim()}`;
      this.dockerComposeConfig = syncBasyxGoImageTag(config, serviceName);
    },
    setBasyxInfraConfig(config: ConfigObject) {
      const managedOrigin = this.managedInfluxDbOrigin;
      if (managedOrigin) {
        const origins = getInfrastructureTrustedOrigins(config, managedOrigin.infrastructureKey);
        if (
          origins &&
          !origins.includes(managedOrigin.origin) &&
          getDefaultInfrastructureKey(config) === managedOrigin.infrastructureKey
        ) {
          this.managedInfluxDbOrigin = undefined;
          this.localInfluxDbOriginOptOutKey = managedOrigin.infrastructureKey;
        }
      }
      this.basyxInfraConfig = config;
      this.syncManagedLocalInfluxDbOrigin();
    },
    updateDefaultInfrastructureTrustedOrigins(origins: readonly string[]): boolean {
      const normalizedOrigins = origins.map(parseTrustedOrigin);
      if (normalizedOrigins.some(origin => origin === null)) {
        return false;
      }

      const currentConfig = this.basyxInfraConfig;
      if (!currentConfig || !isRecord(currentConfig.value)) {
        return false;
      }

      const updatedConfig = cloneSerializable(currentConfig);
      if (!isRecord(updatedConfig.value) || !isRecord(updatedConfig.value.infrastructures)) {
        return false;
      }

      const infrastructures = updatedConfig.value.infrastructures;
      const defaultKey = infrastructures.default;
      if (typeof defaultKey !== 'string' || !isRecord(infrastructures[defaultKey])) {
        return false;
      }

      const infrastructure = infrastructures[defaultKey];
      if (normalizedOrigins.length > 0) {
        infrastructure.trustedOrigins = normalizedOrigins as string[];
      } else {
        delete infrastructure.trustedOrigins;
      }
      infrastructures[defaultKey] = infrastructure;
      this.basyxInfraConfig = updatedConfig;

      const managedOrigin = this.managedInfluxDbOrigin;
      if (
        managedOrigin?.infrastructureKey === defaultKey &&
        !normalizedOrigins.includes(managedOrigin.origin)
      ) {
        this.managedInfluxDbOrigin = undefined;
        this.localInfluxDbOriginOptOutKey = defaultKey;
      }

      const localOrigin = getLocalInfluxDbOrigin(
        this.timeSeriesData,
        this.externalBaseUrl,
        this.containerPorts,
        this.dockerComposeConfig
      );
      if (
        this.localInfluxDbOriginOptOutKey === defaultKey &&
        localOrigin &&
        normalizedOrigins.includes(localOrigin)
      ) {
        this.localInfluxDbOriginOptOutKey = undefined;
        this.managedInfluxDbOrigin = { infrastructureKey: defaultKey, origin: localOrigin };
      }
      return true;
    },
    syncManagedLocalInfluxDbOrigin(): void {
      let infraConfig = this.basyxInfraConfig;
      const defaultKey = getDefaultInfrastructureKey(infraConfig);
      const localOrigin = getLocalInfluxDbOrigin(
        this.timeSeriesData,
        this.externalBaseUrl,
        this.containerPorts,
        this.dockerComposeConfig
      );
      const managedOrigin = this.managedInfluxDbOrigin;
      const managedOriginStillCurrent = Boolean(
        managedOrigin &&
        managedOrigin.infrastructureKey === defaultKey &&
        managedOrigin.origin === localOrigin
      );

      if (managedOrigin && !managedOriginStillCurrent) {
        const origins = getInfrastructureTrustedOrigins(
          infraConfig,
          managedOrigin.infrastructureKey
        );
        if (origins) {
          infraConfig =
            withInfrastructureTrustedOrigins(
              infraConfig,
              managedOrigin.infrastructureKey,
              origins.filter(origin => origin !== managedOrigin.origin)
            ) ?? infraConfig;
        }
        this.managedInfluxDbOrigin = undefined;
      }

      if (!defaultKey || !localOrigin || this.localInfluxDbOriginOptOutKey === defaultKey) {
        this.basyxInfraConfig = infraConfig;
        return;
      }

      const origins = getInfrastructureTrustedOrigins(infraConfig, defaultKey);
      if (!origins) {
        this.basyxInfraConfig = infraConfig;
        return;
      }

      if (managedOriginStillCurrent) {
        if (!origins.includes(localOrigin)) {
          infraConfig =
            withInfrastructureTrustedOrigins(infraConfig, defaultKey, [...origins, localOrigin]) ??
            infraConfig;
        }
        this.basyxInfraConfig = infraConfig;
        return;
      }

      if (!origins.includes(localOrigin)) {
        this.basyxInfraConfig =
          withInfrastructureTrustedOrigins(infraConfig, defaultKey, [...origins, localOrigin]) ??
          infraConfig;
        this.managedInfluxDbOrigin = { infrastructureKey: defaultKey, origin: localOrigin };
        return;
      }

      this.basyxInfraConfig = infraConfig;
    },
    updateServiceEnvironment(
      serviceName: string,
      values: Record<string, string>,
      removeKeys: string[] = []
    ) {
      const currentConfig = this.dockerComposeConfig;
      const currentValue = currentConfig?.value;
      if (!currentConfig || !isRecord(currentValue) || !isRecord(currentValue.services)) {
        return;
      }

      const dockerComposeConfig = cloneSerializable(currentConfig);
      const composeValue = dockerComposeConfig.value;
      if (!isRecord(composeValue) || !isRecord(composeValue.services)) {
        return;
      }
      const services = composeValue.services as Record<string, DockerComposeService>;
      const service = services[serviceName];
      if (!service) {
        return;
      }

      if (!service.environment) {
        service.environment = [];
      }
      service.environment = removeEnvironmentKeys(service.environment, removeKeys);
      Object.entries(values).forEach(([key, value]) => {
        setEnvironmentValue(service.environment as Environment, key, value);
      });
      this.setDockerComposeConfig(dockerComposeConfig);
    },
    initializeStarterDefaults() {
      this.updateUserInterface(true);
      this.externalBaseUrl = normalizeExternalBaseUrl(this.externalBaseUrl);
      const aasEnvironmentExternalPort =
        getContainerPortValue(this.containerPorts, 'aas-environment') ??
        DEFAULT_AAS_ENVIRONMENT_EXTERNAL_PORT;
      const aasEnvironmentContextPath = getContextPathValue(this.contextPathes, 'aas-environment');

      if (!this.dockerComposeConfig?.value) {
        this.setDockerComposeConfig(
          createDefaultDockerComposeConfig(
            this.externalBaseUrl,
            aasEnvironmentExternalPort,
            aasEnvironmentContextPath
          )
        );
      }

      if (!this.basyxInfraConfig?.value) {
        this.setBasyxInfraConfig(
          createDefaultInfraConfig(
            this.externalBaseUrl,
            aasEnvironmentExternalPort,
            aasEnvironmentContextPath
          )
        );
      }
      this.applyExternalBaseUrlToGeneratedConfigs();
    },
    applyExternalBaseUrlToGeneratedConfigs() {
      const externalBaseUrl = buildAasEnvironmentExternalUrl(
        this.externalBaseUrl,
        getContainerPortValue(this.containerPorts, 'aas-environment'),
        getContextPathValue(this.contextPathes, 'aas-environment')
      );

      const currentComposeValue = this.dockerComposeConfig?.value;
      if (isRecord(currentComposeValue) && isRecord(currentComposeValue.services)) {
        const dockerComposeConfig = { ...this.dockerComposeConfig };
        const services = currentComposeValue.services as Record<string, unknown>;
        const aasEnvironment = services['aas-environment'];
        if (isRecord(aasEnvironment)) {
          const environment = aasEnvironment.environment;
          if (isStringRecord(environment) || Array.isArray(environment)) {
            setEnvironmentValue(environment, 'GENERAL_EXTERNALURL', externalBaseUrl);
            aasEnvironment.environment = environment;
            services['aas-environment'] = aasEnvironment;
          }
          this.setDockerComposeConfig(dockerComposeConfig);
        }
      }

      if (
        this.basyxInfraConfig?.value &&
        typeof this.basyxInfraConfig.value === 'object' &&
        'infrastructures' in this.basyxInfraConfig.value
      ) {
        const basyxInfraConfig = { ...this.basyxInfraConfig };
        const infrastructures = (
          basyxInfraConfig.value as {
            infrastructures: Record<string, unknown>;
          }
        ).infrastructures;
        const defaultKey = infrastructures.default;
        if (typeof defaultKey !== 'string') {
          return;
        }

        const infra = infrastructures[defaultKey];
        if (!infra || typeof infra !== 'object') {
          return;
        }

        const infraRecord = { ...(infra as Record<string, unknown>) };
        const components =
          (infraRecord.components as Record<string, Record<string, unknown>> | undefined) || {};
        const componentPaths: Record<string, string> = {
          aasDiscovery: 'lookup/shells',
          aasRegistry: 'shell-descriptors',
          submodelRegistry: 'submodel-descriptors',
          aasRepository: 'shells',
          submodelRepository: 'submodels',
          conceptDescriptionRepository: 'concept-descriptions',
        };

        Object.entries(componentPaths).forEach(([componentName, path]) => {
          if (components[componentName]) {
            components[componentName].baseUrl = joinBaseUrl(externalBaseUrl, path);
          }
        });

        infraRecord.components = components;
        infrastructures[defaultKey] = infraRecord;
        basyxInfraConfig.value = { infrastructures };
        this.setBasyxInfraConfig(basyxInfraConfig);
      }
    },
    createSerializableSnapshot(): SerializableStarterState {
      return cloneSerializable({
        registryIntegration: this.registryIntegration,
        discoveryIntegration: this.discoveryIntegration,
        externalBaseUrl: this.externalBaseUrl,
        mqtt: this.mqtt,
        timeSeriesData: this.timeSeriesData,
        includeTelegraf: this.includeTelegraf,
        includeLocalInfluxDb: this.includeLocalInfluxDb,
        externalInfluxSettings: this.externalInfluxSettings,
        userInterface: this.userInterface,
        dashboard: this.dashboard,
        aasDiscovery: this.aasDiscovery,
        syncBranding: this.syncBranding,
        customColor: this.customColor,
        lightPrimaryColor: this.lightPrimaryColor,
        darkPrimaryColor: this.darkPrimaryColor,
        containerPorts: this.containerPorts,
        containerNames: this.containerNames,
        contextPathes: this.contextPathes,
        basyxConfig: this.basyxConfig,
        dockerComposeConfig: this.dockerComposeConfig,
        basyxInfraConfig: this.basyxInfraConfig,
        managedInfluxDbOrigin: this.managedInfluxDbOrigin,
        localInfluxDbOriginOptOutKey: this.localInfluxDbOriginOptOutKey,
        thirdPartyServices: this.thirdPartyServices,
        thirdPartyArchitecture: this.thirdPartyArchitecture,
      });
    },
    applySerializableSnapshot(snapshot: unknown) {
      if (!snapshot || typeof snapshot !== 'object') {
        return;
      }

      const data = snapshot as Record<string, unknown>;

      const booleanKeys = [
        'registryIntegration',
        'discoveryIntegration',
        'mqtt',
        'timeSeriesData',
        'userInterface',
        'dashboard',
        'aasDiscovery',
        'syncBranding',
      ] as const;
      booleanKeys.forEach(key => {
        if (typeof data[key] === 'boolean') {
          this[key] = data[key];
        }
      });

      const stringKeys = [
        'externalBaseUrl',
        'customColor',
        'lightPrimaryColor',
        'darkPrimaryColor',
      ] as const;
      stringKeys.forEach(key => {
        if (typeof data[key] === 'string') {
          this[key] = data[key];
        }
      });

      if (isContainerPortArray(data.containerPorts)) {
        this.containerPorts = cloneSerializable(data.containerPorts);
      }
      if (isContainerNameArray(data.containerNames)) {
        this.containerNames = cloneSerializable(data.containerNames);
      }
      if (isContextPathArray(data.contextPathes)) {
        this.contextPathes = cloneSerializable(data.contextPathes);
      }
      if (data.thirdPartyArchitecture === 'amd64' || data.thirdPartyArchitecture === 'arm64') {
        this.thirdPartyArchitecture = data.thirdPartyArchitecture;
      }
      if (isThirdPartyServiceSelectionArray(data.thirdPartyServices)) {
        this.thirdPartyServices = cloneSerializable(data.thirdPartyServices);
      }
      if (isBasyxConfigArray(data.basyxConfig)) {
        const defaults = initialState();
        this.basyxConfig = mergeBasyxConfigDefaults(defaults.basyxConfig, data.basyxConfig);
      }
      if (isConfigObject(data.dockerComposeConfig)) {
        const defaultDockerComposeConfig = createDefaultDockerComposeConfig(
          this.externalBaseUrl,
          getContainerPortValue(this.containerPorts, 'aas-environment'),
          getContextPathValue(this.contextPathes, 'aas-environment')
        );
        this.dockerComposeConfig = mergeDockerComposeConfig(
          defaultDockerComposeConfig,
          data.dockerComposeConfig
        );
      }
      const legacyExternalSettings = readExternalInfluxSettings(this.dockerComposeConfig);
      if (isExternalInfluxSettings(data.externalInfluxSettings)) {
        this.externalInfluxSettings = {
          url: data.externalInfluxSettings.url ?? '',
          org: data.externalInfluxSettings.org ?? 'basyx',
          bucket: data.externalInfluxSettings.bucket ?? 'basyx',
          token: data.externalInfluxSettings.token ?? '',
        };
      } else if (legacyExternalSettings) {
        this.externalInfluxSettings = {
          url: legacyExternalSettings.url ?? '',
          org: legacyExternalSettings.org ?? 'basyx',
          bucket: legacyExternalSettings.bucket ?? 'basyx',
          token: legacyExternalSettings.token ?? '',
        };
      }
      this.includeTelegraf =
        typeof data.includeTelegraf === 'boolean'
          ? data.includeTelegraf
          : this.timeSeriesData
            ? hasTelegraf(this.dockerComposeConfig)
            : false;
      this.includeLocalInfluxDb =
        typeof data.includeLocalInfluxDb === 'boolean'
          ? data.includeLocalInfluxDb
          : this.timeSeriesData
            ? hasLocalInfluxDb(this.dockerComposeConfig)
            : true;
      if (isConfigObject(data.basyxInfraConfig)) {
        this.basyxInfraConfig = cloneSerializable(data.basyxInfraConfig);
      }
      if (
        isRecord(data.managedInfluxDbOrigin) &&
        typeof data.managedInfluxDbOrigin.infrastructureKey === 'string'
      ) {
        const origin = parseTrustedOrigin(data.managedInfluxDbOrigin.origin);
        this.managedInfluxDbOrigin = origin
          ? {
              infrastructureKey: data.managedInfluxDbOrigin.infrastructureKey,
              origin,
            }
          : undefined;
      } else {
        this.managedInfluxDbOrigin = undefined;
      }
      this.localInfluxDbOriginOptOutKey =
        typeof data.localInfluxDbOriginOptOutKey === 'string'
          ? data.localInfluxDbOriginOptOutKey
          : undefined;
      this.localInfluxDbWasPresent = hasLocalInfluxDb(this.dockerComposeConfig);
      if (typeof data.externalBaseUrl === 'string') {
        this.applyExternalBaseUrlToGeneratedConfigs();
      }
      this.syncManagedLocalInfluxDbOrigin();
    },

    // legacy setters
    setAasEnvConfig(config: ConfigObject) {
      this.aasEnvConfig = config;
    },
    setAasRegistryConfig(config: ConfigObject) {
      this.aasRegistryConfig = config;
    },
    setSubmodelRegistryConfig(config: ConfigObject) {
      this.submodelRegistryConfig = config;
    },
    setAasDiscoveryConfig(config: ConfigObject) {
      this.aasDiscoveryConfig = config;
    },
    setDashboardConfig(config: ConfigObject) {
      this.dashboardConfig = config;
    },

    setContainerPort(serviceName: string, port: number | undefined) {
      const containerPort = this.containerPorts.find(item => item.id === serviceName);
      if (containerPort) {
        containerPort.port = port;
      } else {
        this.containerPorts.push({ id: serviceName, port });
      }
      if (
        this.dockerComposeConfig?.value &&
        typeof this.dockerComposeConfig.value === 'object' &&
        'services' in this.dockerComposeConfig.value
      ) {
        const dockerComposeConfig = { ...this.dockerComposeConfig };
        const services = (
          dockerComposeConfig.value as { services: Record<string, DockerComposeService> }
        ).services;
        setDockerComposeServicePort(services, serviceName, port);
        this.setDockerComposeConfig(dockerComposeConfig);
      }
      if (serviceName === 'aas-environment') {
        this.externalBaseUrl = replaceExplicitUrlPort(this.externalBaseUrl, port);
        this.applyExternalBaseUrlToGeneratedConfigs();
      }
    },
    setContainerName(serviceName: string, name: string | undefined) {
      const containerName = this.containerNames.find(item => item.id === serviceName);
      if (containerName) {
        containerName.name = name;
      } else {
        this.containerNames.push({ id: serviceName, name });
      }
    },
    setContextPath(serviceName: string, contextPath: string | undefined) {
      const normalizedContextPath =
        contextPath && contextPath.trim() !== '' ? contextPath.trim() : undefined;
      const contextPathObj = this.contextPathes.find(item => item.id === serviceName);
      if (contextPathObj) {
        contextPathObj.contextPath = normalizedContextPath;
      }
      if (
        this.dockerComposeConfig?.value &&
        typeof this.dockerComposeConfig.value === 'object' &&
        'services' in this.dockerComposeConfig.value
      ) {
        const dockerComposeConfig = { ...this.dockerComposeConfig };
        const services = (
          dockerComposeConfig.value as { services: Record<string, DockerComposeService> }
        ).services;
        setDockerComposeServiceContextPath(services, serviceName, normalizedContextPath);
        this.setDockerComposeConfig(dockerComposeConfig);
      }
      if (serviceName === 'aas-environment') {
        this.externalBaseUrl = replaceUrlPath(this.externalBaseUrl, normalizedContextPath);
        this.applyExternalBaseUrlToGeneratedConfigs();
      }
    },
    reset() {
      Object.assign(this, initialState());
    },
  },
});

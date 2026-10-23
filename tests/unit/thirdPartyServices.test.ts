import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildThirdPartyServiceCompose,
  defaultThirdPartyValues,
  parseThirdPartyServiceCatalog,
  resolveThirdPartyServiceReferences,
  thirdPartyFieldError,
  thirdPartyManagedServiceIds,
} from '@/utils/thirdPartyServices';

const catalog = `
version: 1
services:
  - id: redis
    name: Redis
    description: In-memory data store.
    tags: [cache, integration]
    compose:
      redis:
        image: redis:8.2.2-alpine
        ports: ["127.0.0.1:6379:6379"]
    configuration:
      - key: REDIS_PASSWORD
        label: Password
        type: password
        environment: REDIS_PASSWORD
`;

describe('third-party service catalogue', () => {
  it('ships the supported third-party services in deployment order', () => {
    const shippedCatalog = readFileSync('public/third-party-services.yaml', 'utf8');

    const services = parseThirdPartyServiceCatalog(shippedCatalog);

    expect(services.map(service => service.id)).toEqual([
      'aas-suite-community',
      'mnestix-browser',
      'david-sme-adapter',
      'pgadmin',
    ]);
    expect(services.find(service => service.id === 'aas-suite-community')?.compose).toHaveProperty(
      'aas-suite-gateway'
    );
    expect(services.find(service => service.id === 'mnestix-browser')?.compose).toHaveProperty(
      'mnestix-browser'
    );
    expect(services.find(service => service.id === 'david-sme-adapter')?.compose).toHaveProperty(
      'david-sme-adapter'
    );
    expect(
      services.find(service => service.id === 'david-sme-adapter')?.unsupportedArchitectures
    ).toEqual({
      arm64: 'The davidadap/sme-adapter image has no ARM64 version.',
    });

    const resolution = resolveThirdPartyServiceReferences(
      services,
      {
        'aas-suite-community': { databasePassword: 'suite-password' },
        'mnestix-browser': {},
        'david-sme-adapter': {},
      },
      {
        'aas-environment': { image: 'eclipsebasyx/aasenvironment-go:latest', ports: ['8082:8082'] },
      }
    );

    expect(resolution.errors).toEqual([]);
    expect(resolution.values['mnestix-browser']?.aasRepositoryUrl).toBe('http://localhost:8082');
    expect(resolution.values['david-sme-adapter']?.basyxBaseUrl).toBe(
      'http://aas-environment:8082'
    );

    const suite = services.find(service => service.id === 'aas-suite-community');
    expect(suite).toBeDefined();
    if (!suite) throw new Error('Meta-Level AAS Suite Community is missing.');
    expect(
      buildThirdPartyServiceCompose(suite, resolution.values['aas-suite-community'] || {})[
        'aas-suite-database'
      ]
    ).toMatchObject({ environment: { POSTGRES_PASSWORD: 'suite-password' } });
  });

  it('rejects short AAS Suite signing secrets before they can produce invalid application tokens', () => {
    const services = parseThirdPartyServiceCatalog(
      readFileSync('public/third-party-services.yaml', 'utf8')
    );
    const field = services
      .find(service => service.id === 'aas-suite-community')!
      .configuration.find(field => field.key === 'jwtSecret')!;
    expect(thirdPartyFieldError(field, '')).toBe('Required');
    expect(thirdPartyFieldError(field, 'test')).toBe('Use at least 32 characters.');
    expect(thirdPartyFieldError(field, 'a'.repeat(31))).toBe('Use at least 32 characters.');
    expect(thirdPartyFieldError(field, 'a'.repeat(32))).toBeUndefined();
    expect(thirdPartyFieldError(field, 'a'.repeat(64))).toBeUndefined();
  });

  it('chooses optional ARM64 defaults without changing normal defaults or saved choices', () => {
    const services = parseThirdPartyServiceCatalog(
      readFileSync('public/third-party-services.yaml', 'utf8')
    );
    const suite = services.find(service => service.id === 'aas-suite-community')!;
    expect(defaultThirdPartyValues(suite, 'arm64').imageTag).toBe('1.1.3-arm64');
    expect(defaultThirdPartyValues(suite, 'amd64').imageTag).toBe('1.1.3');
    expect(defaultThirdPartyValues(suite, 'unknown').imageTag).toBe('1.1.3');
    expect({ ...defaultThirdPartyValues(suite, 'arm64'), imageTag: '1.1.3' }.imageTag).toBe(
      '1.1.3'
    );
    const redis = parseThirdPartyServiceCatalog(catalog)[0]!;
    expect(defaultThirdPartyValues(redis, 'arm64')).toEqual(defaultThirdPartyValues(redis));
  });

  it('includes retired suite containers when replacing an existing selection', () => {
    const services = parseThirdPartyServiceCatalog(
      readFileSync('public/third-party-services.yaml', 'utf8')
    );
    expect(thirdPartyManagedServiceIds(services)).toContain('aas-suite-registry');
    expect(thirdPartyManagedServiceIds(services)).toContain('aas-suite-configuration');
    expect(thirdPartyManagedServiceIds(services)).not.toContain('aas-environment');
  });

  it('parses supported services and applies only selected configuration values', () => {
    const services = parseThirdPartyServiceCatalog(catalog);
    const [redis] = services;

    expect(services).toHaveLength(1);
    expect(redis).toMatchObject({ id: 'redis', tags: ['cache', 'integration'] });
    expect(redis).toBeDefined();
    if (!redis) throw new Error('Redis service is missing.');
    expect(buildThirdPartyServiceCompose(redis, { REDIS_PASSWORD: 'change-me' })).toEqual({
      redis: {
        image: 'redis:8.2.2-alpine',
        ports: ['127.0.0.1:6379:6379'],
        environment: { REDIS_PASSWORD: 'change-me' },
      },
    });
  });

  it('rejects catalogue entries that collide with BaSyx service ids', () => {
    expect(() =>
      parseThirdPartyServiceCatalog(catalog.replace('redis:', 'aas-environment:'))
    ).toThrow(/reserved/i);
  });

  it('resolves service metadata and another service configuration value', () => {
    const services = parseThirdPartyServiceCatalog(`
version: 1
services:
  - id: redis
    name: Redis
    description: Cache
    compose:
      redis:
        image: redis:8.2.2-alpine
        ports: ["127.0.0.1:6379:6379"]
    configuration:
      - key: database
        label: Database
        type: text
        default: cache
  - id: worker
    name: Worker
    description: Worker
    compose:
      worker:
        image: example/worker:1.0.0
    configuration:
      - key: cacheUrl
        label: Cache URL
        type: text
        default: "redis://{{ services.redis.host }}:{{ services.redis.port }}/{{ services.redis.config.database }}"
`);

    const resolution = resolveThirdPartyServiceReferences(
      services,
      {
        redis: { database: 'cache' },
        worker: {},
      },
      { db: { image: 'postgres:16', ports: ['5432:5432'] } }
    );

    expect(resolution.errors).toEqual([]);
    expect(resolution.values.worker?.cacheUrl).toBe('redis://redis:6379/cache');
  });

  it('reports missing services and circular configuration references', () => {
    const services = parseThirdPartyServiceCatalog(`
version: 1
services:
  - id: worker
    name: Worker
    description: Worker
    compose:
      worker:
        image: example/worker:1.0.0
    configuration:
      - key: first
        label: First
        type: text
        default: "{{ services.worker.config.second }}"
      - key: second
        label: Second
        type: text
        default: "{{ services.worker.config.first }}"
      - key: target
        label: Target
        type: text
        default: "{{ services.redis.host }}"
`);

    const resolution = resolveThirdPartyServiceReferences(services, { worker: {} });

    expect(resolution.errors.join(' ')).toMatch(/circular/i);
    expect(resolution.errors.join(' ')).toMatch(/not selected/i);
  });

  it('resolves placeholders from the current Compose service configuration', () => {
    const services = parseThirdPartyServiceCatalog(`
version: 1
services:
  - id: worker
    name: Worker
    description: Worker
    compose:
      worker:
        image: example/worker:1.0.0
    configuration:
      - key: databaseName
        label: Database name
        type: text
        default: "{{ services.db.config.POSTGRES_DB }}"
`);

    const resolution = resolveThirdPartyServiceReferences(
      services,
      { worker: {} },
      {
        db: {
          image: 'postgres:16',
          environment: { POSTGRES_DB: 'basyxTestDB', POSTGRES_USER: 'admin' },
        },
      }
    );

    expect(resolution.errors).toEqual([]);
    expect(resolution.values.worker?.databaseName).toBe('basyxTestDB');
  });
});

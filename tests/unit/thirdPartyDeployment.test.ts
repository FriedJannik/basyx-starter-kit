import type { ComposeService } from '@/utils/optionalServices';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { useAppStore } from '@/stores/app';
import { addAasSuiteAssets } from '@/utils/aasSuiteAssets';
import { decodeConfigHash, encodeConfigHash, setQueryParam } from '@/utils/configPersistence';
import {
  buildThirdPartyServiceCompose,
  defaultThirdPartyValues,
  parseThirdPartyServiceCatalog,
  resolveThirdPartyServiceReferences,
  thirdPartyManagedServiceIds,
  validateThirdPartyServices,
} from '@/utils/thirdPartyServices';

const catalog = parseThirdPartyServiceCatalog(
  readFileSync('public/third-party-services.yaml', 'utf8')
);
const suite = catalog.find(service => service.id === 'aas-suite-community')!;
function composeServices(): Record<string, ComposeService> {
  return (
    useAppStore().getDockerComposeConfig!.value as { services: Record<string, ComposeService> }
  ).services;
}
function setupSuite(extra: Record<string, string> = {}): ReturnType<typeof useAppStore> {
  const store = useAppStore();
  store.initializeStarterDefaults();
  const values = {
    ...defaultThirdPartyValues(suite),
    databasePassword: 'dummy-db-password',
    adminPassword: 'dummy-admin-password',
    jwtSalt: 'a'.repeat(44),
    jwtSecret: 'b'.repeat(64),
    ...extra,
  };
  const resolution = resolveThirdPartyServiceReferences(
    catalog,
    { [suite.id]: values },
    composeServices()
  );
  store.setThirdPartyServices(
    [{ id: suite.id, values }],
    buildThirdPartyServiceCompose(suite, resolution.values[suite.id]!),
    thirdPartyManagedServiceIds(catalog)
  );
  return store;
}
function shareRoundTrip(store: ReturnType<typeof useAppStore>): void {
  const decoded = decodeConfigHash(
    encodeConfigHash({ route: '/get-started/download', state: store.createSerializableSnapshot() })
  );
  expect(decoded.error).toBeUndefined();
  store.$reset();
  store.applySerializableSnapshot(decoded.payload!.state);
}

describe('third-party deployment correctness', () => {
  it('uses Docker DNS and internal ports for all six Mnestix API defaults', () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    composeServices()['aas-environment']!.ports = ['127.0.0.1:9000:8082'];
    const mnestix = catalog.find(service => service.id === 'mnestix-browser')!;
    const result = resolveThirdPartyServiceReferences(
      catalog,
      { [mnestix.id]: defaultThirdPartyValues(mnestix) },
      composeServices()
    );
    for (const field of mnestix.configuration.filter(field =>
      field.environment?.endsWith('API_URL')
    )) {
      expect(result.values[mnestix.id]![field.key]).toBe('http://aas-environment:8082');
    }
  });

  it('refreshes references after port edits while keeping explicit container edits', () => {
    const store = setupSuite();
    store.setContainerPort('aas-suite-gateway', 5090);
    const services = composeServices();
    services['aas-suite-designer']!.image = 'example/designer:custom';
    Object.assign(services['aas-suite-designer']!.environment!, {
      MANUAL: 'keep',
      AppSettings__PublicBaseApiUrl: 'https://custom.example/api',
    });
    expect(store.refreshThirdPartyServices(catalog)).toEqual([]);
    expect(services === composeServices()).toBe(false);
    expect(composeServices()['aas-suite-gateway']!.environment).toMatchObject({
      AppSettings__KeycloakPublicIssuer: 'http://localhost:5090/realms/aas-local',
    });
    expect(composeServices()['aas-suite-frontend']!.environment).toMatchObject({
      FRONTEND_API_BASE_URL: 'http://localhost:5090/designer-api',
    });
    expect(composeServices()['aas-suite-designer']).toMatchObject({
      image: 'example/designer:custom',
      environment: { MANUAL: 'keep', AppSettings__PublicBaseApiUrl: 'https://custom.example/api' },
    });
    expect(composeServices()['aas-suite-gateway']!.ports).toEqual(['127.0.0.1:5090:8080']);
    expect(store.getThirdPartyServices[0]!.values.publicUrl).toContain('{{');
  });

  it('keeps explicit application URLs when regenerating', () => {
    const store = setupSuite({ publicUrl: 'https://suite.example' });
    store.setContainerPort('aas-suite-gateway', 5090);
    expect(store.refreshThirdPartyServices(catalog)).toEqual([]);
    expect(composeServices()['aas-suite-gateway']!.environment).toMatchObject({
      AppSettings__KeycloakPublicIssuer: 'https://suite.example/realms/aas-local',
    });
  });

  it.each(['http://localhost:5080/', ' http://localhost:5080/// '])(
    'normalizes %s consistently in Compose and realm assets',
    async publicUrl => {
      const store = setupSuite({ publicUrl });
      const services = composeServices();
      expect(validateThirdPartyServices(catalog, store.getThirdPartyServices, services)).toEqual(
        []
      );
      expect(services['aas-suite-gateway']!.environment).toMatchObject({
        AppSettings__KeycloakPublicIssuer: 'http://localhost:5080/realms/aas-local',
      });
      const zip = new JSZip();
      addAasSuiteAssets(zip, services);
      const realm = JSON.parse(await zip.file('aas-suite/realm.json')!.async('string'));
      expect(
        realm.clients.find(
          (client: { clientId: string }) => client.clientId === 'aas-designer-local'
        ).redirectUris
      ).toEqual(['http://localhost:5080/*']);
    }
  );
  it.each([
    'localhost:5080',
    'javascript:alert(1)',
    'https://suite.example/?q=1',
    'https://suite.example/#fragment',
  ])('rejects invalid base URL %s', publicUrl => {
    const store = setupSuite({ publicUrl });
    expect(
      validateThirdPartyServices(catalog, store.getThirdPartyServices, composeServices()).join(' ')
    ).toMatch(/HTTP.*URL/i);
  });
});

describe('compact additional-service sharing', () => {
  it('keeps the default AAS Suite share URL below the existing warning threshold', () => {
    const store = setupSuite();
    const state = store.createSerializableSnapshot();
    expect(state.thirdPartyServiceDefaults).toBeUndefined();
    expect(
      (state.dockerComposeConfig!.value as { services: Record<string, unknown> }).services[
        'aas-suite-gateway'
      ]
    ).toBeUndefined();
    const url =
      '/get-started/download' +
      setQueryParam('', 'cfg', encodeConfigHash({ route: '/get-started/download', state }));
    expect(url.length).toBeLessThan(6000);
  });
  it('restores ports, images, environment overrides and deletions, and regenerates the merge baseline', () => {
    const store = setupSuite();
    store.setContainerPort('aas-suite-gateway', 5090);
    const services = composeServices();
    services['aas-suite-designer']!.image = 'example/designer:custom';
    services['aas-suite-frontend']!.environment = [
      'FRONTEND_API_BASE_URL=https://manual.example/designer-api',
      'FRONTEND_FEEDMAPPING_BASE_URL=https://manual.example',
      'MANUAL=keep',
      'PRIVATE_TOKEN=do-not-share',
    ];
    Reflect.deleteProperty(services['aas-suite-designer']!, 'healthcheck');
    (services['aas-suite-designer']!.environment as Record<string, string>).MANUAL = 'keep';
    shareRoundTrip(store);
    expect(composeServices()['aas-suite-gateway']!.ports).toEqual(['127.0.0.1:5090:8080']);
    expect(composeServices()['aas-suite-designer']).toMatchObject({
      image: 'example/designer:custom',
      environment: { MANUAL: 'keep' },
    });
    expect(composeServices()['aas-suite-designer']).not.toHaveProperty('healthcheck');
    expect(composeServices()['aas-suite-frontend']!.environment).toContain('MANUAL=keep');
    expect(JSON.stringify(composeServices())).not.toContain('do-not-share');
    expect(JSON.stringify(composeServices())).not.toContain('dummy-db-password');
    expect(store.thirdPartyServiceDefaults['aas-suite-gateway']).toBeDefined();
    store.setContainerPort('aas-suite-gateway', 5091);
    expect(store.refreshThirdPartyServices(catalog)).toEqual([]);
    expect(composeServices()['aas-suite-gateway']!.environment).toMatchObject({
      AppSettings__KeycloakPublicIssuer: 'http://localhost:5091/realms/aas-local',
    });
    expect(composeServices()['aas-suite-designer']).not.toHaveProperty('healthcheck');
  });
  it('round-trips all catalogue selections and ARM64 tags in a compact share', () => {
    const store = setupSuite({ imageTag: '1.1.3-arm64' });
    store.thirdPartyArchitecture = 'arm64';
    const selections = catalog.map(service => ({
      id: service.id,
      values:
        service.id === suite.id
          ? store.getThirdPartyServices[0]!.values
          : defaultThirdPartyValues(service),
    }));
    const resolution = resolveThirdPartyServiceReferences(
      catalog,
      Object.fromEntries(selections.map(selection => [selection.id, selection.values])),
      composeServices()
    );
    const additions = Object.assign(
      {},
      ...catalog.map(service =>
        buildThirdPartyServiceCompose(service, resolution.values[service.id]!)
      )
    );
    store.setThirdPartyServices(selections, additions, thirdPartyManagedServiceIds(catalog));
    shareRoundTrip(store);
    expect(store.getThirdPartyServices.map(service => service.id)).toEqual(
      catalog.map(service => service.id)
    );
    expect(store.thirdPartyArchitecture).toBe('arm64');
    expect(composeServices()['aas-suite-gateway']!.image).toContain(':1.1.3-arm64');
    expect(composeServices()['mnestix-browser']!.environment).toMatchObject({
      AAS_REPO_API_URL: 'http://aas-environment:8082',
    });
    expect(composeServices().pgadmin).toBeDefined();
    expect(
      validateThirdPartyServices(
        catalog,
        store.getThirdPartyServices,
        composeServices(),
        'arm64'
      ).join(' ')
    ).toContain('Unavailable on ARM64');
  });
  it('preserves explicit null values and handles missing fields in compact snapshots', () => {
    const store = setupSuite();
    composeServices()['aas-suite-designer']!.command = null;
    Reflect.deleteProperty(
      composeServices()['aas-suite-gateway']!.environment as Record<string, string>,
      'GatewayBackend__FrontendLoginPath'
    );
    shareRoundTrip(store);
    expect(composeServices()['aas-suite-designer']!.command).toBeNull();
    expect(composeServices()['aas-suite-gateway']!.environment).not.toHaveProperty(
      'GatewayBackend__FrontendLoginPath'
    );
  });
  it('still restores expanded legacy snapshots', () => {
    const store = setupSuite();
    const snapshot = {
      ...store.createSerializableSnapshot(),
      dockerComposeConfig: JSON.parse(JSON.stringify(store.getDockerComposeConfig)),
      thirdPartyServiceDefaults: JSON.parse(JSON.stringify(store.thirdPartyServiceDefaults)),
    };
    Reflect.deleteProperty(snapshot, 'thirdPartyServiceOverrides');
    store.$reset();
    store.applySerializableSnapshot(snapshot);
    store.setContainerPort('aas-suite-gateway', 5092);
    expect(store.refreshThirdPartyServices(catalog)).toEqual([]);
    expect(composeServices()['aas-suite-gateway']!.environment).toMatchObject({
      AppSettings__KeycloakPublicIssuer: 'http://localhost:5092/realms/aas-local',
    });
  });
});

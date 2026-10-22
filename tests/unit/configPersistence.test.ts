import type { SerializableStarterState } from '@/stores/app';
import {
  canonicalStringify,
  decodeConfigHash,
  encodeConfigHash,
  parseHashParams,
  parseQueryParams,
  readConfigHashFromUrl,
  readConfigQueryFromUrl,
  setHashParam,
  setQueryParam,
  shouldWarnForLength,
} from '@/utils/configPersistence';

function createState(): SerializableStarterState {
  return {
    registryIntegration: true,
    discoveryIntegration: true,
    externalBaseUrl: 'http://localhost:8082',
    mqtt: false,
    timeSeriesData: false,
    userInterface: true,
    dashboard: false,
    aasDiscovery: true,
    customColor: '',
    syncBranding: false,
    lightPrimaryColor: '#fff',
    darkPrimaryColor: '#000',
    containerPorts: [{ id: 'aas-environment', port: 8082 }],
    containerNames: [{ id: 'aas-environment', name: 'aas-environment' }],
    contextPathes: [{ id: 'aas-ui', contextPath: '/ui' }],
    basyxConfig: [],
    dockerComposeConfig: {
      name: 'docker-compose.yml',
      value: {
        services: {
          'aas-environment': {
            environment: {
              POSTGRES_PASSWORD: 'admin123',
              SERVER_PORT: '8082',
            },
          },
        },
      },
    },
    basyxInfraConfig: {
      name: 'basyx-infra.yml',
      value: { infrastructures: { default: 'infra1' } },
    },
  };
}

describe('configPersistence', () => {
  it('round-trips v1 payload with route', () => {
    const encoded = encodeConfigHash({
      route: '/get-started/visualization/ui',
      state: createState(),
    });
    const decoded = decodeConfigHash(encoded);

    expect(decoded.error).toBeUndefined();
    expect(decoded.payload?.route).toBe('/get-started/visualization/ui');
    expect(decoded.payload?.state.userInterface).toBe(true);
  });

  it('strips sensitive keys from payload', () => {
    const encoded = encodeConfigHash({
      route: '/get-started/application',
      state: createState(),
    });
    const decoded = decodeConfigHash(encoded);
    const env = (
      (decoded.payload?.state.dockerComposeConfig?.value as Record<string, unknown>)?.services as
        Record<string, unknown> | undefined
    )?.['aas-environment'] as Record<string, unknown> | undefined;

    const environment = (env?.environment || {}) as Record<string, string>;
    expect(environment.POSTGRES_PASSWORD).toBeUndefined();
    expect(environment.SERVER_PORT).toBe('8082');
  });

  it('strips AAS Suite database connection strings from shared configurations', () => {
    const state = createState();
    state.dockerComposeConfig = {
      name: 'docker-compose.yml',
      value: {
        services: {
          gateway: {
            environment: { Session__Postgres__ConnectionString: 'Host=db;Password=private' },
          },
          designer: {
            environment: [
              'ConnectionStrings__PgDatabase=Host=db;Password=private',
              'SERVER_PORT=8080',
            ],
          },
        },
      },
    };
    const decoded = decodeConfigHash(encodeConfigHash({ route: '/get-started/download', state }));
    expect(JSON.stringify(decoded.payload)).not.toContain('private');
    expect(JSON.stringify(decoded.payload)).toContain('SERVER_PORT=8080');
  });

  it('returns error for unsupported version', () => {
    const decoded = decodeConfigHash('v999.abcd');
    expect(decoded.error).toContain('Unsupported');
  });

  it('excludes binary-like fields from payload', () => {
    const file = new File(['demo'], 'demo.txt', { type: 'text/plain' });
    const encoded = encodeConfigHash({
      route: '/get-started/introduction',
      state: {
        ...createState(),
        dockerComposeConfig: {
          name: 'docker-compose.yml',
          value: {
            attachment: file,
            services: {
              'aas-environment': {
                environment: ['SERVER_PORT=8082'],
              },
            },
          },
        },
      },
    });

    const decoded = decodeConfigHash(encoded);
    const value = decoded.payload?.state.dockerComposeConfig?.value as
      Record<string, unknown> | undefined;
    expect(value?.attachment).toBeUndefined();
  });

  it('keeps canonical string stable for different key order', () => {
    const first = canonicalStringify({ b: 1, a: { y: 2, x: 1 } });
    const second = canonicalStringify({ a: { x: 1, y: 2 }, b: 1 });
    expect(first).toBe(second);
  });

  it('handles hash param read/write helpers', () => {
    const hash = setHashParam('#foo=bar', 'cfg', 'v1.a+b');
    const params = parseHashParams(hash);
    expect(params.get('foo')).toBe('bar');
    expect(readConfigHashFromUrl(hash)).toBe('v1.a+b');
    expect(hash).toContain('v1.a%2Bb');
  });

  it('reads cfg hash with raw plus signs without corrupting payload', () => {
    expect(readConfigHashFromUrl('#cfg=v1.a+b')).toBe('v1.a+b');
  });

  it('handles query param read/write helpers', () => {
    const query = setQueryParam('?foo=bar', 'cfg', 'v1.a+b');
    const params = parseQueryParams(query);
    expect(params.get('foo')).toBe('bar');
    expect(readConfigQueryFromUrl(query)).toBe('v1.a+b');
    expect(query).toContain('v1.a%2Bb');
  });

  it('warn helper triggers for long urls', () => {
    expect(shouldWarnForLength('x'.repeat(2000), 1800)).toBe(true);
    expect(shouldWarnForLength('x'.repeat(100), 1800)).toBe(false);
  });
});

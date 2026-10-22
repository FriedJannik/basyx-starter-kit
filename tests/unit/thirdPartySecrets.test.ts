import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/stores/app';
import { buildPersistedPayload } from '@/utils/configPersistence';
import {
  buildThirdPartyServiceCompose,
  initializeThirdPartyValues,
  parseThirdPartyServiceCatalog,
  type ThirdPartyService,
} from '@/utils/thirdPartyServices';

function suite(): ThirdPartyService {
  return parseThirdPartyServiceCatalog(
    readFileSync('public/third-party-services.yaml', 'utf8')
  ).find(service => service.id === 'aas-suite-community')!;
}

afterEach(() => vi.restoreAllMocks());

describe('generated third-party secrets', () => {
  it('generates the Mnestix encryption key as Base64-encoded 32 random bytes and keeps it stable', () => {
    const service = parseThirdPartyServiceCatalog(
      readFileSync('public/third-party-services.yaml', 'utf8')
    ).find(service => service.id === 'mnestix-browser')!;
    const values = initializeThirdPartyValues(service);
    expect(typeof values.secretEncryptionKey).toBe('string');
    expect(atob(String(values.secretEncryptionKey))).toHaveLength(32);
    expect(
      buildThirdPartyServiceCompose(service, values)['mnestix-browser']?.environment
    ).toMatchObject({ SECRET_ENC_KEY: values.secretEncryptionKey });
    expect(initializeThirdPartyValues(service, values).secretEncryptionKey).toBe(
      values.secretEncryptionKey
    );
    expect(initializeThirdPartyValues(service).secretEncryptionKey).not.toBe(
      values.secretEncryptionKey
    );
  });

  it('generates independent cryptographic signing secrets and base64 salts once', () => {
    const source = vi.spyOn(crypto, 'getRandomValues');
    const first = initializeThirdPartyValues(suite());
    expect(first.jwtSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(atob(String(first.jwtSalt))).toHaveLength(32);
    expect(source).toHaveBeenCalledTimes(2);
    const restored = initializeThirdPartyValues(suite(), first);
    expect(restored).toEqual(first);
    expect(source).toHaveBeenCalledTimes(2);
    const separate = initializeThirdPartyValues(suite());
    expect(separate.jwtSecret).not.toBe(first.jwtSecret);
    expect(separate.jwtSalt).not.toBe(first.jwtSalt);
  });

  it('replaces a legacy short signing secret and preserves valid existing secrets', () => {
    const values = initializeThirdPartyValues(suite(), {
      jwtSecret: 'test',
      databasePassword: 'keep-me',
    });
    expect(values.jwtSecret).toHaveLength(64);
    expect(values.databasePassword).toBe('keep-me');
    const existing = 'existing-secret-'.repeat(4);
    expect(initializeThirdPartyValues(suite(), { jwtSecret: existing }).jwtSecret).toBe(existing);
  });

  it('removes generated values from shared links and generates fresh ones when restoring', () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    const service = suite();
    const values = initializeThirdPartyValues(service);
    store.thirdPartyServices = [{ id: service.id, values }];
    store.setThirdPartyServices(
      store.thirdPartyServices,
      buildThirdPartyServiceCompose(service, values),
      Object.keys(service.compose)
    );
    const shared = buildPersistedPayload({
      route: '/get-started/deployment/additional-services',
      state: store.createSerializableSnapshot(),
    });
    expect(JSON.stringify(shared)).not.toContain(values.jwtSecret);
    expect(JSON.stringify(shared)).not.toContain(values.jwtSalt);
    const restored = initializeThirdPartyValues(
      service,
      shared.state.thirdPartyServices![0]!.values
    );
    expect(restored.jwtSecret).toHaveLength(64);
    expect(restored.jwtSecret).not.toBe(values.jwtSecret);
  });

  it('fails rather than generating weak secrets if secure randomness is unavailable', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    expect(() => initializeThirdPartyValues(suite())).toThrow();
  });
});

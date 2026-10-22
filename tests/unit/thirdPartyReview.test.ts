import { describe, expect, it } from 'vitest';
import { useAppStore } from '@/stores/app';
import {
  buildThirdPartyServiceCompose,
  parseThirdPartyServiceCatalog,
  validateThirdPartyServices,
} from '@/utils/thirdPartyServices';

const source = `version: 1
services:
  - id: app
    name: App
    description: App
    compose:
      app:
        image: example/app:1
        environment: [INHERITED, 'KEEP=value']
      sidecar:
        image: example/sidecar:1
    configuration:
      - key: password
        label: Password
        type: password
        environment: PASSWORD
        service: app
`;

describe('third-party review regressions', () => {
  it('applies an environment-backed credential only to its target and preserves pass-through entries', () => {
    const service = parseThirdPartyServiceCatalog(source)[0]!;
    const compose = buildThirdPartyServiceCompose(service, { password: 'a$HOME' });
    expect(compose.app!.environment).toEqual(['INHERITED', 'KEEP=value', 'PASSWORD=a$$HOME']);
    expect(compose.sidecar!.environment).toBeUndefined();
  });
  it('validates the selected inputs and actual output independently of wizard navigation', () => {
    const services = parseThirdPartyServiceCatalog(source);
    const compose = buildThirdPartyServiceCompose(services[0]!, { password: 'value' });
    expect(
      validateThirdPartyServices(services, [{ id: 'app', values: { password: 'value' } }], compose)
    ).toEqual([]);
    expect(
      validateThirdPartyServices(services, [{ id: 'app', values: {} }], {}).join(' ')
    ).toContain('missing');
    expect(
      validateThirdPartyServices(services, [{ id: 'unknown', values: {} }], {}).join(' ')
    ).toContain('Unknown');
  });

  it('preserves inherited environment entries when a legacy snapshot lacks a generated baseline', () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    const config = JSON.parse(JSON.stringify(store.getDockerComposeConfig!));
    config.value.services.app = {
      image: 'example/app:custom',
      environment: ['INHERITED', 'PASSWORD=old', 'MANUAL=keep'],
    };
    store.setDockerComposeConfig(config);
    store.setThirdPartyServices(
      [{ id: 'app', values: {} }],
      { app: { image: 'example/app:1', environment: ['INHERITED', 'PASSWORD=new'] } },
      ['app']
    );
    expect((store.getDockerComposeConfig!.value as typeof config.value).services.app).toMatchObject(
      { image: 'example/app:custom', environment: ['INHERITED', 'PASSWORD=new', 'MANUAL=keep'] }
    );
  });

  it('rejects ambiguous and unknown targets', () => {
    expect(() =>
      parseThirdPartyServiceCatalog(source.replace('        service: app\n', ''))
    ).toThrow(/target|service/i);
    expect(() =>
      parseThirdPartyServiceCatalog(source.replace('service: app', 'service: missing'))
    ).toThrow(/target|service/i);
  });
  it('keeps Docker edits when regenerating application settings, including after snapshot restoration', () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    const generated = {
      app: {
        image: 'example/app:1',
        ports: ['8080:80'],
        environment: { APP_VALUE: 'old', KEEP: 'unchanged' },
      },
    };
    store.setThirdPartyServices([{ id: 'app', values: {} }], generated, ['app']);
    const config = JSON.parse(JSON.stringify(store.getDockerComposeConfig!));
    Object.assign(config.value.services.app, {
      image: 'example/app:custom',
      ports: ['[::1]:9090:80'],
      container_name: 'my-app',
    });
    config.value.services.app.environment.EXTRA = 'manual';
    store.setDockerComposeConfig(config);
    const snapshot = store.createSerializableSnapshot();
    store.$reset();
    store.applySerializableSnapshot(snapshot);
    store.setThirdPartyServices(
      [{ id: 'app', values: {} }],
      { app: { ...generated.app, environment: { APP_VALUE: 'new', KEEP: 'unchanged' } } },
      ['app']
    );
    expect((store.getDockerComposeConfig!.value as typeof config.value).services.app).toMatchObject(
      {
        image: 'example/app:custom',
        ports: ['[::1]:9090:80'],
        container_name: 'my-app',
        environment: { APP_VALUE: 'new', EXTRA: 'manual' },
      }
    );
  });
});

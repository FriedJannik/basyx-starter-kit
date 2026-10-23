import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addAasSuiteAssets } from '@/utils/aasSuiteAssets';
import {
  buildThirdPartyServiceCompose,
  parseThirdPartyServiceCatalog,
  resolveThirdPartyServiceReferences,
} from '@/utils/thirdPartyServices';

const catalog = parseThirdPartyServiceCatalog(`version: 1
services:
  - id: worker
    name: Worker
    description: Worker
    compose:
      worker:
        image: example/worker:1
    configuration:
      - key: target
        label: Target
        type: text
        environment: TARGET
`);

describe('PR 95 follow-up remarks', () => {
  it.each([
    'POSTGRES_PASSWORD',
    'API_TOKEN',
    'ConnectionStrings__PgDatabase',
    'privateKey',
    'AppSettings__Salt',
  ])('rejects sensitive references to %s in both environment formats', key => {
    for (const environment of [
      { [key]: 'dummy-sensitive-value' },
      [`${key}=dummy-sensitive-value`],
    ]) {
      const result = resolveThirdPartyServiceReferences(
        catalog,
        { worker: { target: `{{ services.db.config.${key} }}` } },
        { db: { environment } }
      );
      expect(result.errors.join(' ')).toMatch(/sensitive/i);
      expect(
        JSON.stringify(buildThirdPartyServiceCompose(catalog[0]!, result.values.worker || {}))
      ).not.toContain('dummy-sensitive-value');
    }
  });

  it('rejects password-field references even when their key has no sensitive words', () => {
    const producer = parseThirdPartyServiceCatalog(`version: 1
services:
  - id: producer
    name: Producer
    description: Producer
    compose:
      producer-container:
        image: example/producer:1
    configuration:
      - key: accessValue
        label: Access value
        type: password
        environment: ACCESS_VALUE
`)[0]!;
    for (const reference of [
      'producer.config.accessValue',
      'producer-container.config.ACCESS_VALUE',
    ]) {
      const result = resolveThirdPartyServiceReferences(
        [...catalog, producer],
        {
          worker: { target: `{{ services.${reference} }}` },
          producer: { accessValue: 'dummy-sensitive-value' },
        },
        { 'producer-container': { environment: { ACCESS_VALUE: 'dummy-sensitive-value' } } }
      );
      expect(result.errors.join(' ')).toMatch(/sensitive/i);
      expect(result.values.worker?.target).not.toContain('dummy-sensitive-value');
    }
  });

  it.each(['tcp', 'udp', 'sctp'])(
    'resolves numeric internal ports from IPv6 mappings with /%s',
    protocol => {
      const result = resolveThirdPartyServiceReferences(
        catalog,
        { worker: { target: 'http://{{ services.db.host }}:{{ services.db.port }}' } },
        { db: { ports: [`[::1]:8080:80/${protocol}`] } }
      );
      expect(result.errors).toEqual([]);
      expect(result.values.worker?.target).toBe('http://db:80');
    }
  );

  it('exports AAS Suite assets with an array-form issuer', async () => {
    const zip = new JSZip();
    addAasSuiteAssets(zip, {
      'aas-suite-gateway': {
        environment: ['AppSettings__KeycloakPublicIssuer=http://localhost:5080/realms/aas-local'],
      },
      'aas-suite-keycloak': {},
    });
    const realm = JSON.parse(await zip.file('aas-suite/realm.json')!.async('string'));
    expect(
      realm.clients.find((client: { clientId: string }) => client.clientId === 'aas-designer-local')
        .rootUrl
    ).toBe('http://localhost:5080');
  });

  it('does not ship a bootstrap administrator in the source realm', () => {
    const source = readFileSync('assets/aas-suite/realm.json', 'utf8');
    expect(JSON.parse(source).users).toEqual([]);
    expect(source).not.toContain('local-provisioner');
    expect(source).not.toContain('"credentials"');
  });
});

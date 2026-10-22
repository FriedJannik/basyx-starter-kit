import type { ComposeService } from '@/utils/optionalServices';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addAasSuiteAssets } from '@/utils/aasSuiteAssets';
import {
  buildThirdPartyServiceCompose,
  parseThirdPartyServiceCatalog,
  resolveThirdPartyServiceReferences,
} from '@/utils/thirdPartyServices';

function buildSuite(password = 'suite-password'): Record<string, ComposeService> {
  const catalog = parseThirdPartyServiceCatalog(
    readFileSync('public/third-party-services.yaml', 'utf8')
  );
  const suite = catalog.find(service => service.id === 'aas-suite-community');
  if (!suite) throw new Error('AAS Suite catalogue entry is missing.');
  const resolution = resolveThirdPartyServiceReferences(
    catalog,
    { 'aas-suite-community': { databasePassword: password, adminPassword: 'admin-password' } },
    { 'aas-environment': { image: 'eclipsebasyx/aasenvironment-go:latest', ports: ['8181:8081'] } }
  );
  expect(resolution.errors).toEqual([]);
  return buildThirdPartyServiceCompose(suite, resolution.values['aas-suite-community'] || {});
}

describe('official AAS Suite Community deployment', () => {
  it('runs the official application with its own databases and identity provider', () => {
    const compose = buildSuite();
    expect(Object.keys(compose).sort()).toEqual([
      'aas-suite-database',
      'aas-suite-designer',
      'aas-suite-frontend',
      'aas-suite-gateway',
      'aas-suite-keycloak',
      'aas-suite-keycloak-database',
    ]);
    for (const [id, image] of [
      ['aas-suite-gateway', 'aas-designer-gateway'],
      ['aas-suite-designer', 'aas-designer-backend-community'],
      ['aas-suite-frontend', 'aas-designer-frontend-community'],
    ]) {
      expect(compose[id!]?.image).toBe(
        `ghcr.io/meta-level-public/aas-suite-community/${image}:1.1.3`
      );
    }
    expect(compose['aas-suite-designer']?.environment).toMatchObject({
      ConnectionStrings__PgDatabase:
        'Host=aas-suite-database;Port=5432;Database=aas_designer;Username=aas_user;Password="suite-password"',
      AppSettings__InitialAasRepositoryUrl: 'http://aas-environment:8081',
      AppSettings__InitialSubmodelRepositoryUrl: 'http://aas-environment:8081',
      AppSettings__KeycloakIssuer: 'http://aas-suite-keycloak:8080/realms/aas-local',
      AppSettings__KeycloakPublicIssuer: 'http://localhost:5080/realms/aas-local',
      AppSettings__KeycloakAdminPassword: 'admin-password',
    });
    expect(compose['aas-suite-keycloak']).toMatchObject({
      depends_on: { 'aas-suite-keycloak-database': { condition: 'service_healthy' } },
      environment: { KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin-password' },
    });
    expect(compose['aas-suite-gateway']).toMatchObject({
      ports: ['127.0.0.1:5080:8080'],
      depends_on: { 'aas-suite-keycloak': { condition: 'service_healthy' } },
    });
  });

  it('preserves special characters in Compose and quoted database connection strings', () => {
    const compose = buildSuite('a;"b$HOME');
    expect(compose['aas-suite-database']?.environment).toMatchObject({
      POSTGRES_PASSWORD: 'a;"b$$HOME',
    });
    expect(compose['aas-suite-designer']?.environment).toMatchObject({
      ConnectionStrings__PgDatabase:
        'Host=aas-suite-database;Port=5432;Database=aas_designer;Username=aas_user;Password="a;""b$$HOME"',
    });
    expect(compose['aas-suite-frontend']?.environment).not.toHaveProperty('POSTGRES_PASSWORD');
  });

  it('bundles the realm, frontend startup script, and upstream license for portable downloads', async () => {
    const compose = buildSuite();
    const zip = new JSZip();
    addAasSuiteAssets(zip, compose);
    const realm = JSON.parse((await zip.file('aas-suite/realm.json')?.async('string')) || '{}');
    expect(realm.realm).toBe('aas-local');
    expect(realm.users).toEqual([]);
    expect(realm).not.toHaveProperty('loginTheme');
    expect(
      realm.clients.find((client: { clientId: string }) => client.clientId === 'aas-designer-local')
    ).toMatchObject({
      redirectUris: ['http://localhost:5080/*'],
      webOrigins: ['http://localhost:5080'],
    });
    expect(zip.file('aas-suite/frontend-start.sh')).not.toBeNull();
    expect(zip.file('aas-suite/LICENSE')).not.toBeNull();
    const emptyZip = new JSZip();
    addAasSuiteAssets(emptyZip, {});
    expect(Object.keys(emptyZip.files)).toEqual([]);
  });
});

import type { ComposeService } from '@/utils/optionalServices';
import type JSZip from 'jszip';
import frontendStart from '@/assets/aas-suite/frontend-start.sh?raw';
import license from '@/assets/aas-suite/LICENSE?raw';
import upstreamRealm from '@/assets/aas-suite/realm.json';

/** Portable assets adapted from the official Community deployment. */
export function addAasSuiteAssets(zip: JSZip, services: Record<string, ComposeService>): string {
  if (!services['aas-suite-gateway']) return '';
  const gatewayEnvironment = services['aas-suite-gateway'].environment;
  const publicIssuer =
    gatewayEnvironment && !Array.isArray(gatewayEnvironment)
      ? gatewayEnvironment.AppSettings__KeycloakPublicIssuer
      : undefined;
  if (!publicIssuer) throw new Error('AAS Suite public Keycloak issuer is missing.');
  const publicUrl = publicIssuer.replace(/\/realms\/aas-local\/?$/, '').replaceAll('$$', '$');
  const realm = JSON.parse(JSON.stringify(upstreamRealm)) as Record<string, unknown>;
  // Use built-in Keycloak themes and provision users through the Designer bootstrap.
  Reflect.deleteProperty(realm, 'loginTheme');
  Reflect.deleteProperty(realm, 'emailTheme');
  Reflect.deleteProperty(realm, 'smtpServer');
  realm.users = [];
  realm.clients = upstreamRealm.clients.map(client =>
    client.clientId === 'aas-designer-local'
      ? {
          ...client,
          rootUrl: publicUrl,
          baseUrl: publicUrl,
          redirectUris: [`${publicUrl}/*`],
          webOrigins: [publicUrl],
        }
      : client
  );
  if (services['aas-suite-keycloak'])
    zip.file('aas-suite/realm.json', JSON.stringify(realm, null, 2));
  if (services['aas-suite-frontend']) zip.file('aas-suite/frontend-start.sh', frontendStart);
  zip.file('aas-suite/LICENSE', license);
  return `\n## Meta-Level AAS Suite Community\n\nOpen ${publicUrl}. Sign in with the initial administrator email and password configured under Additional Services. The suite uses this setup's BaSyx infrastructure. Database, storage, and gateway keys persist under \`aas-suite/\`. Keycloak uses its built-in theme; configure SMTP separately for email delivery.\n`;
}

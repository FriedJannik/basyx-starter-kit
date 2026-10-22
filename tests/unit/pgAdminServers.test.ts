import { describe, expect, it } from 'vitest';
import { createPgAdminServersJson } from '@/utils/pgAdminServers';

describe('pgAdmin server template', () => {
  it('registers the local BaSyx PostgreSQL database with its configured credentials', () => {
    const servers = JSON.parse(
      createPgAdminServersJson({
        POSTGRES_USER: 'basyx-user',
        POSTGRES_DB: 'basyx-db',
      })
    ) as { Servers: Record<string, Record<string, unknown>> };

    expect(servers.Servers['1']).toEqual({
      Name: 'BaSyx PostgreSQL',
      Group: 'Servers',
      Host: 'db',
      Port: 5432,
      MaintenanceDB: 'basyx-db',
      Username: 'basyx-user',
      SSLMode: 'prefer',
    });
  });

  it('creates an empty server list when the local BaSyx database is not part of the setup', () => {
    expect(JSON.parse(createPgAdminServersJson())).toEqual({ Servers: {} });
  });
});

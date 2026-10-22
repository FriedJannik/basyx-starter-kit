export function createPgAdminServersJson(databaseEnvironment?: Record<string, string>): string {
  if (!databaseEnvironment) {
    return JSON.stringify({ Servers: {} }, null, 2);
  }

  return JSON.stringify(
    {
      Servers: {
        '1': {
          Name: 'BaSyx PostgreSQL',
          Group: 'Servers',
          Host: 'db',
          Port: 5432,
          MaintenanceDB: databaseEnvironment.POSTGRES_DB || 'basyxTestDB',
          Username: databaseEnvironment.POSTGRES_USER || 'admin',
          SSLMode: 'prefer',
        },
      },
    },
    null,
    2
  );
}

import pg from 'pg';

export async function ensureDatabase(connectionString) {
  const url = new URL(connectionString);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!dbName) {
    throw new Error('Database name is missing in DATABASE_URL');
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`);
  }

  url.pathname = '/postgres';
  const adminPool = new pg.Pool({ connectionString: url.toString() });

  try {
    const { rows } = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );

    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database: ${dbName}`);
    }
  } finally {
    await adminPool.end();
  }
}

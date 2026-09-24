import pg from 'pg';

const { Client } = pg;

async function run() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    database: 'postgres',
  });

  await client.connect();
  console.log('connected as postgres');

  const userCheck = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = 'tracker_user'"
  );
  if (userCheck.rowCount === 0) {
    await client.query("CREATE USER tracker_user WITH PASSWORD 'tracker_pass'");
    console.log('created user tracker_user');
  } else {
    console.log('user tracker_user already exists');
  }

  const dbCheck = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'time_tracker'"
  );
  if (dbCheck.rowCount === 0) {
    await client.query('CREATE DATABASE time_tracker OWNER tracker_user');
    console.log('created database time_tracker');
  } else {
    console.log('database time_tracker already exists');
  }

  await client.end();
  console.log('bootstrap complete');
}

run().catch((err) => {
  console.error('bootstrap failed:', err.message);
  process.exit(1);
});
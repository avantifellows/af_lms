const { Pool } = require('pg');
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

async function check() {
  const client = await pool.connect();
  try {
    // Check metadata column
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'batch' AND column_name = 'metadata'
    `);
    console.log('batch.metadata column:', cols.rows[0]?.data_type || 'NOT FOUND');

    // Check school_visit table
    const visitTable = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'school_visit'
    `);
    console.log('school_visit table:', visitTable.rows.length > 0 ? 'EXISTS' : 'NOT FOUND');

    if (visitTable.rows.length > 0) {
      const visitCols = await client.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'school_visit'
        ORDER BY ordinal_position
      `);
      console.log('\nschool_visit columns:');
      visitCols.rows.forEach(c => console.log('  - ' + c.column_name + ' (' + c.data_type + ')'));
    }

    // Get batches with their metadata
    if (cols.rows.length > 0) {
      const batches = await client.query(`
        SELECT id, name, contact_hours_per_week, metadata
        FROM batch
        WHERE name LIKE 'JNV NVS G1%' AND name NOT LIKE '%Region%'
        ORDER BY name
      `);
      console.log('\nJNV NVS batches with metadata:');
      batches.rows.forEach(b => {
        console.log(b.name + ': ' + JSON.stringify(b.metadata));
      });
    }
  } finally {
    client.release();
    await pool.end();
  }
}
check().catch(console.error);

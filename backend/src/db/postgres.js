const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.PG_CONNECTION_STRING;
    if (!connectionString) {
      const err = new Error("Missing PG_CONNECTION_STRING.");
      err.statusCode = 500;
      throw err;
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

async function runSql({ text, values = [] }) {
  const client = await getPool().connect();
  try {
    const res = await client.query(text, values);
    return res;
  } finally {
    client.release();
  }
}

module.exports = { runSql, closePool };


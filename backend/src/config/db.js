const { env } = require("./env");

function dbConfig() {
  return {
    kind: env.dbKind,
    neo4j: { ...env.neo4j },
    postgres: { connectionString: process.env.PG_CONNECTION_STRING || "" }
  };
}

module.exports = { dbConfig };


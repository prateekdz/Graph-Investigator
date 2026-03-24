const neo4j = require("neo4j-driver");
const { env } = require("../config/env");

let driver;

function getDriver() {
  if (!driver) {
    driver = neo4j.driver(env.neo4j.uri, neo4j.auth.basic(env.neo4j.user, env.neo4j.password), {
      disableLosslessIntegers: true
    });
  }
  return driver;
}

async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = undefined;
  }
}

async function runCypher({ query, params = {}, timeoutMs }) {
  const session = getDriver().session({ database: env.neo4j.database });
  try {
    const result = await session.run(query, params, timeoutMs ? { timeout: timeoutMs } : undefined);
    return result;
  } finally {
    await session.close();
  }
}

module.exports = { runCypher, closeDriver };


import "server-only";

import neo4j, { type Driver } from "neo4j-driver";

const state = globalThis as typeof globalThis & { auraDriver?: Driver };

export function getNeo4jDriver() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !username || !password || /YOUR-/i.test(uri) || /YOUR-/i.test(password)) {
    throw new Error("Set real NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD values in .env.local.");
  }
  state.auraDriver ??= neo4j.driver(uri, neo4j.auth.basic(username, password), {
    connectionTimeout: 10_000,
    connectionAcquisitionTimeout: 10_000,
    maxTransactionRetryTime: 0,
  });
  return state.auraDriver;
}

export async function checkNeo4jConnection() {
  const driver = getNeo4jDriver();
  await driver.verifyConnectivity();
  const { records } = await driver.executeQuery("RETURN 1 AS connected", {}, {
    database: process.env.NEO4J_DATABASE || "neo4j",
    routing: neo4j.routing.READ,
    transactionConfig: { timeout: 5_000 },
  });
  if (records[0]?.get("connected").toNumber() !== 1) {
    throw new Error("Neo4j connection query returned an unexpected result.");
  }
}

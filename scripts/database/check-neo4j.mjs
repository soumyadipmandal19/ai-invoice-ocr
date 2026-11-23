import neo4j from "neo4j-driver";

let driver;
try {
  const { NEO4J_URI: uri, NEO4J_USERNAME: username, NEO4J_PASSWORD: password } = process.env;
  if (!uri || !username || !password || /YOUR-/i.test(uri) || /YOUR-/i.test(password)) {
    throw new Error("Replace the Neo4j placeholders in .env.local with your Aura URI, database username, and database password.");
  }
  driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    connectionTimeout: 10_000,
    connectionAcquisitionTimeout: 10_000,
    maxTransactionRetryTime: 0,
  });
  await driver.verifyConnectivity();
  const { records } = await driver.executeQuery("RETURN 1 AS connected", {}, {
    database: process.env.NEO4J_DATABASE || "neo4j",
    routing: neo4j.routing.READ,
    transactionConfig: { timeout: 5_000 },
  });
  if (records[0]?.get("connected").toNumber() !== 1) throw new Error("Unexpected connection query result.");
  console.log("Neo4j Aura connected: credentials and database query verified.");
} catch (error) {
  // Avoid printing connection details or credentials from driver errors.
  console.error("Neo4j check failed.");
  if (!driver) console.error(error.message);
  else console.error("Check Aura is running, the database credentials/name are correct, and the network can reach Aura.");
  process.exitCode = 1;
} finally {
  await driver?.close();
}

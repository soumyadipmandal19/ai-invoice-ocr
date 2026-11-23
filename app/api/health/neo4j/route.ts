import { getUser } from "@/lib/server/auth/session";
import { checkNeo4jConnection } from "@/lib/server/database/neo4j";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!(await getUser())) {
    return Response.json({ error: "Sign in to check the database connection." }, { status: 401, headers });
  }
  try {
    await checkNeo4jConnection();
    return Response.json({ connected: true }, { headers });
  } catch {
    return Response.json(
      { connected: false, error: "Neo4j connection failed. Check the server configuration and run npm run check:neo4j." },
      { status: 503, headers },
    );
  }
}

import { getUser } from "@/lib/server/auth/session";

// The entry URL only redirects. Finish the session check before sending a
// response, rather than throwing a redirect after a Suspense shell has streamed.
export async function GET(request: Request) {
  try {
    const user = await getUser();
    return new Response(null, {
      status: 307,
      headers: {
        Location: new URL(user ? "/workspace/dashboard" : "/signin", request.url).href,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Unable to check your session. Please retry.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

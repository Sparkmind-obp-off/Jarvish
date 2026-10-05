export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARTIFACTS: R2Bucket;
  JARVISH_ENV: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "jarvish",
        env: env.JARVISH_ENV,
        phase: "foundation"
      });
    }

    return Response.json({
      service: "jarvish",
      status: "ready",
      message: "Core API boundary is online."
    });
  }
};

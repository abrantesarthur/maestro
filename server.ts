import { serve } from "bun";

const server = serve({
  // TODO: read from environment
  port: 3000,
  routes: {
    "/health": new Response("ok", { status: 200 }),
  },
  // fallback for unmatched routes
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}.`);

import { serve } from "bun";
import { HttpErrorMessage } from "./enum";

const server = serve({
  // TODO: use some environment package that manages required values
  port: process.env["PORT"],
  routes: {
    "/health": new Response("ok\n", { status: 200 }),
  },
  fetch: (request) => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/v1/webhooks/whatsapp") {
      const { searchParams } = url;
      const [mode, challenge, token] = [
        "mode",
        "challenge",
        "verify_token",
      ].map((s) => searchParams.get(`hub.${s}`));
      const expectedToken = process.env["WHATSAPP_VERIFY_TOKEN"];

      const authorized =
        mode === "subscribe" &&
        expectedToken !== undefined &&
        token === expectedToken;

      if (authorized && challenge !== null) {
        return new Response(challenge, { status: 200 });
      }

      return new Response(HttpErrorMessage.Forbidden, { status: 403 });
    }

    return new Response(HttpErrorMessage.NotFound, { status: 404 });
  },
});

console.log(`Server running at ${server.url}.`);

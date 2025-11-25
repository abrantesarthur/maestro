import { serve } from "bun";
import { HttpErrorMessage } from "./enum";

const server = serve({
  // TODO: use some environment package that manages required values
  port: process.env["PORT"],
  routes: {
    "/health": new Response("ok\n", { status: 200 }),
    // FIXME: validate payload https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
    "/v1/webhooks/whatsapp": {
      GET: (req) => {
        const url = new URL(req.url);
        const { searchParams } = url;
        const [mode, challenge, token] = [
          "mode",
          "challenge",
          "verify_token",
        ].map((s) => searchParams.get(`hub.${s}`));
        const expectedToken = process.env["WHATSAPP_VERIFY_TOKEN"];
        if (mode === "subscribe" && token === expectedToken) {
          return new Response(challenge, { status: 200 });
        }
        return new Response(HttpErrorMessage.Forbidden, { status: 403 });
      },
      POST: () => {
        return new Response(HttpErrorMessage.Forbidden, { status: 403 });
      },
    },
  },
  fetch: () => {
    return new Response(HttpErrorMessage.NotFound, { status: 404 });
  },
});

console.log(`Server running at ${server.url}.`);

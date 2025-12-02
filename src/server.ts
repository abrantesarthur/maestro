import { server } from "bunweb";

const app = server();

app.get("/health", async (ctx, next) => {
  ctx.body = "ok";
  await next();
});

app.get("/v1/webhooks/whatsapp", async (ctx, next) => {
  const { searchParams } = ctx;
  const [mode, challenge, token] = ["mode", "challenge", "verify_token"].map(
    (s) => searchParams.get(`hub.${s}`),
  );
  const expectedToken = process.env["WHATSAPP_VERIFY_TOKEN"];
  if (mode === "subscribe" && token === expectedToken) {
    ctx.body = challenge;
  } else {
    ctx.status = 403;
  }
  await next();
});

app.post("/v1/webhooks/whatsapp", async (ctx, next) => {
  // FIXME: validate payload https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
  ctx.status = 403;
  await next();
});

// start app
const httpServer = app.listen({ port: process.env["PORT"] ?? 3000 });
console.log(`Server running at ${httpServer.url}`);

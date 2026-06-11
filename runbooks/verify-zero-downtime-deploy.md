# Verifying the Zero-Downtime Backend Deploy

How to confirm the blue/green deploy keeps the backend serving across a deploy.
Run against a staging host that mirrors production.

## What the strategy claims

1. **Blue/green cutover** — the new image starts on the *idle* color/port; the old
   container keeps serving until the new one is healthy and nginx has reloaded onto
   the new port.
2. **Graceful nginx reload** drains in-flight requests rather than dropping them.
3. **Migrations run before cutover** — a failed migration aborts the deploy with the
   old container still live.
4. **Old container removed last** — only after nginx reloads (post_tasks in
   `ansible/playbooks/backend.yml`).

## Edge case: graceful drain on long requests

The proxy sets `proxy_read_timeout 86400` and `proxy_buffering off`. Open a
slow/streaming request, trigger a deploy mid-flight, and confirm it completes rather
than getting cut at reload. `nginx -s reload` keeps old workers alive until their
connections finish — this is the scenario that exposes a botched reload.

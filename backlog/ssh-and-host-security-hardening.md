# SSH & Host Security Hardening

Status: **Proposed** — this is a prompt to investigate, not a mandate. Treat the
items below as suggestions worth weighing, not requirements to implement.

## Context

Our firewall (`ansible/playbooks/roles/ufw/tasks/main.yml`) intentionally leaves
port 22 open from anywhere so Pulumi can SSH in directly to install and remove
cloudflared (otherwise tearing down the tunnel would lock Pulumi out). That
trade-off is reasonable, but it means SSH is our most exposed inbound surface and
deserves a deliberate look at how well we protect it.

Today the main thing guarding port 22 is **key-based authentication** — droplets
are created with SSH keys attached (`pulumi/image/resources/virtualServer.ts`),
which on DigitalOcean disables root password login by default. That's a solid
baseline, but we currently rely on image defaults rather than asserting our own
posture, and there are no additional layers. This spec collects ideas worth
considering.

## Things we might want to investigate

These are offered in rough order of effort-to-value, lightest first. None are
obligatory — the goal is to decide consciously rather than by default.

### 1. ufw connection rate-limiting (cheapest win)

We could switch the SSH rule from a plain `allow` to ufw's built-in `rule: limit`,
which throttles a source IP making more than ~6 connections in 30s. This cuts the
constant background noise of internet-wide SSH scanners with zero extra packages.
Probably the highest value-per-effort item here.

### 2. Explicit sshd hardening

Rather than trusting the image defaults, we might add a small task that *asserts*
the posture we want, e.g. `PermitRootLogin prohibit-password`,
`PasswordAuthentication no`, a sane `MaxAuthTries`, etc. This makes our security
stance explicit and version-controlled instead of implicit.

### 3. fail2ban

fail2ban watches the SSH auth log and temporarily firewall-bans IPs after repeated
failures. Worth noting its marginal *security* value is low given we're already
key-only (brute force is infeasible without a keypair) — its real benefit would be
log-noise reduction and multi-service coverage. Likely lower priority than (1) and
(2), but worth a mention if we ever broaden the exposed surface.

### 4. Reconcile the SSH port config mismatch

There's an `SSH_PORT` / `pulumi.sshPort` config threaded through the codebase
(`lib/config/schema.ts`, `lib/runPulumi.ts`), implying SSH could run on a
non-standard port — but the ufw rule **hardcodes `to_port: 22`**. If `sshPort` is
ever set to anything other than 22, the firewall would open the wrong port and
lock Pulumi out. We may want ufw to derive its SSH port from the same config
(e.g. a `ufw_ssh_port` var) so the two can't drift. This is a latent correctness
bug as much as a security item.

## Out of scope (for now)

- Source-IP allowlisting on port 22 — probably impractical since Pulumi may run
  from variable IPs, but noted in case we ever pin CI runners to known egress IPs.
- Broader audit of the web (443-from-Cloudflare) and backend (localhost-only)
  rules, which already look reasonably tight.

## Suggested next step

When someone has bandwidth, do a short focused pass: start with the ufw
`rule: limit` change and the sshd-hardening task (items 1 and 2), and resolve the
port-config mismatch (item 4) since it's a real foot-gun. Revisit fail2ban only if
the threat model changes.

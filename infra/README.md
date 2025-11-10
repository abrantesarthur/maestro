# Infra

Infrastructure-as-code and operations tooling for the dalhe.ai stack live here. Each component stays in its own subdirectory with dedicated documentation and deployment scripts.

## Components

- `nginx/` — shared nginx configuration plus automation to push updates to production. Consult `infra/nginx/README.md` before modifying or deploying.
- `pulumi/` — Pulumi programs for provisioning Cloudflare DNS and related cloud resources.

## Working In This Folder

- Make changes inside the relevant component directory and keep cross-cutting scripts co-located with the service they operate.
- Follow the component-specific README to lint, validate, and deploy.
- Keep commits scoped to a single infrastructure component to simplify rollbacks.

New infrastructure pieces should follow the same structure: top-level directory, a README that explains prerequisites, and scripts that can run non-interactively so we can automate them later.

## TODOs

- wire up the whole provisioning workflow in a single run.sh file that consumes sensitive api-keys from the environment and pipes variables from one workflow to the next
    1. run server
    2. run pulumi
    3. run ansible
- update ansible to provision nginx (both install nginx and provision its configuration)
- update ansible to provision ufw policies
- deploy our actual backend server to the droplet
- document everything the droplet is provisioning.
- Update this README to explain the step by step for provisioning a server from zero.
- rename infra/server
- update infra/server to support specifying whether to fully replace the existing droplets after new ones are provisioned.
- consider creating my own docker registry to host images

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
- update this provisioning flow so that it doesn't cause downtime. For instance, we should only bring down the existing servers once the new servers have been spin up and properly set up.
- support skipping the server creation and cloudflare set up and only run ansible. This way, we don't have to fully reboot new servers. In this case, for instance, we do not need to retrieve the list of server IDs at the beginning, since we won't be removing them.
- update ansible to provision nginx (both install nginx and provision its configuration)
- update ansible to provision ufw policies
- deploy our actual backend server to the droplet
- document everything the droplet is provisioning.
- Update this README to explain the step by step for provisioning a server from zero.
- rename infra/server
- update infra/server to support specifying whether to fully replace the existing droplets after new ones are provisioned.
- consider creating my own docker registry to host images


## Codex instructions

Come up with a plan, ask for feedback, then proceed once I approve.

Help me populate infra/run.sh to provision a brand-new server end-to-end with cloudflare set up and ansible playbooks. Here is how I would do it (feel free to base your solution on mine or come up with your own where you see shortfalls)
- Within infra/run.sh, ensure the flags --digital-ocean-api-key, --pulumi-access-token and --cloudflare-api-token are provided.
- authenticate against digitalocean with doctl auth init -t <--digital-ocean-api-key> using node's spawnSync.
- list the existing droplet IDs and save those for later. We will fully remove them once the whole provisioning flow is finished.
- execute infra/server/run.sh to create new servers. List all existing servers IDs again and filter only the IDs of the brand-new servers.
- Use these brand-new IDs to provision pulumi.
- Update infra/README.md to include a section explainin how the run.sh works and what are its pre-requisites (e.g., flags). It should also specify which permisisons each api key must have. For instance, according to the infra/server/README.md the --digital-ocean-api-key must have access to "list SSH keys and create droplets". Base yourself on the instructions at infra/pulumi, and infra/ansible readmes to assess the requirements for the other tokens / api keys as well.

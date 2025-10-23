# Infra

Infrastructure-as-code and operations tooling for the dalhe.ai stack live here. Each component stays in its own subdirectory with dedicated documentation and deployment scripts.

## Components
- `nginx/` — shared nginx configuration plus automation to push updates to production. Consult `infra/nginx/README.md` before modifying or deploying.

## Working In This Folder
- Make changes inside the relevant component directory and keep cross-cutting scripts co-located with the service they operate.
- Follow the component-specific README to lint, validate, and deploy.
- Keep commits scoped to a single infrastructure component to simplify rollbacks.

New infrastructure pieces should follow the same structure: top-level directory, a README that explains prerequisites, and scripts that can run non-interactively so we can automate them later.

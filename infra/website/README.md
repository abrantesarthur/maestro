## Workflow

1. From the repo root run `infra/website/build.sh` (or `bash infra/website/build.sh`). Pass `--output-dir <path>` if you need the build artifacts somewhere else (defaults to `infra/website/dist`).
2. The script ensures the `website/` submodule is present, installs website deps with Bun, runs `bun run build`, and copies the produced `website/dist` folder into the chosen output directory.
3. Consume the artifacts from the selected output directory (e.g., deploy or bundle them).

## Prerequisites

- SSH access to `git@github.com:dalhe-ai/website.git` so the submodule can be cloned/updated.
- `git` available on PATH (used to pull the submodule).
- `bun` installed locally since the build uses Bun commands.

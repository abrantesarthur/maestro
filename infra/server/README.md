# Server Bootstrapper

This directory packages everything needed to provision DigitalOcean droplets.

## Workflow

Run the `run.sh` script. It validates the provided DigitalOcean API token, builds and run a docker image according to the `image/` context which provisions droplets according to the specified `config.env`. If `INTERACTIVE = true` it reads the other configuration values interactively from the CLI.

```bash
./run.sh --api-key "<digital_ocean_api_key>"
```

If you prefer manual control:

```bash
docker build -t "${IMAGE_NAME}" infra/server/image
docker run -it "${IMAGE_NAME}" \
  --api-key "${API_KEY}" \
  --ssh-key-id "${SSH_KEY}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --size "${SIZE}" \
  --name "${NAME}" \
  --count 1
```

Any flag you omit triggers interactive prompts inside the container. Keep the API key confidential and avoid committing real tokens.

### Required flags

| Flag | Purpose |
| --- | --- |
| `--api-key` | The DigitalOcean API token. Create it in the DigitalOcean control panel with permission to list SSH keys and create droplets.   |

### Configuration

Edit `config.env` to set the droplet parameters and credentials:

```env
IMAGE_NAME=<name of the bootstrapping docker image>
DROPLET_REGION=<the geographical region to create the droplet>
DROPLET_OS_IMAGE=<the droplet OS image>
DROPLET_SSH_KEY_ID=<the publich ssh key id. It must already exist within Digital Ocean>
DROPLET_SIZE=<the droplet size>
DROPLET_NAME=<the droplet name>
DROPLET_COUNT=<how many droplets to create>

```

When `DROPLET_COUNT` is greater than `1`, the bootstrapper will append a numeric suffix (`-1`, `-2`, …) to the requested `DROPLET_NAME` to keep each droplet unique.

Every droplet also gets an automatic SSH tag so you can easily target it with `doctl`. The tag format is `ssh-<letter>`, where the letter reflects the droplet index (`ssh-a` for the first droplet, `ssh-b` for the second, and so on, rolling to `aa`, `ab`, … if you go past 26). No extra configuration is required—just make sure `DROPLET_COUNT` (or `--count`) matches the number of droplets you expect so the ordering stays predictable.

## Components

- `image/` – Docker build context containing `Dockerfile` and `entrypoint.sh`.
- `run.sh` – convenience script that builds the image and runs the container.
- `config.env` – environment-style configuration consumed by `run.sh`.

## Future Improvements

1. Support tagging servers with the environment (dev or prod)
2. Support destroying existing servers as well. This will be useful if we ever want to fully migrate to a new server later (we'll want to destroy the old infra after the migration is successful)
- automate the pushing of the ssh key to the droplet the first time we create the server.
- automate adding new ssh key to the droplet. Perhaps better done via ansible. See https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/to-existing-droplet/.
- Explain better the relevance of the DROPLET_SSH_KEY_ID. Mention that it must be manually inserted into DigitalOcean and its private counterpart must be stored in the client machine sshing into the server.
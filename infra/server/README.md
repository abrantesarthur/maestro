# Server Bootstrapper

This directory packages everything needed to provision a DigitalOcean droplet through a Dockerized helper script.

- `image/` – Docker build context containing `Dockerfile` and `entrypoint.sh`.
- `run.sh` – convenience script that builds the image and runs the container.
- `config.env` – environment-style configuration consumed by `run.sh`.

## Configure

Edit `config.env` to set the droplet parameters and credentials:

```env
IMAGE_NAME=<name of the bootstrapping docker image>
DROPLET_REGION=<the geographical region to create the droplet>
DROPLET_OS_IMAGE=<the droplet OS image>
DROPLET_SSH_KEY_ID=<the publich ssh key id. It must already exist within Digital Ocean>
DROPLET_SIZE=<the droplet size>
DROPLET_NAME=<the droplet name>

```

## Build & Run via run.sh

`run.sh` requires the DigitalOcean API token to be passed explicitly—the script never reads it from `config.env`. Generate a token with access to list SSH keys and create droplets in the DigitalOcean control panel, then run:

```bash
./run.sh --api-key "<digital_ocean_api_key>"
```

All remaining settings come from `config.env`. The script builds `IMAGE_NAME` from `image/` and forwards those values into the container. Set `INTERACTIVE=true` in `config.env` to skip flag validation and answer prompts inside the container instead.

## Manual Workflow

If you prefer manual control:

```bash
docker build -t "${IMAGE_NAME}" infra/bootstrap/image
docker run -it "${IMAGE_NAME}" \
  --api-key "${API_KEY}" \
  --ssh-key-id "${SSH_KEY}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --size "${SIZE}" \
  --name "${NAME}"
```

Any flag you omit triggers interactive prompts inside the container. Keep the API key confidential and avoid committing real tokens.

## Future Improvements

1. Support tagging servers with the environment (dev or prod)
2. Support destroying existing servers as well. This will be useful if we ever want to fully migrate to a new server later (we'll want to destroy the old infra after the migration is successful)

## TODO

1. Explain better the relevance of the DROPLET_SSH_KEY_ID. Mention that it must be manually inserted into DigitalOcean and its private counterpart must be stored in the client machine sshing into the server.
2. Explore ways to automate the pushing of this public key to the droplet the first time we create a server.
3. Explore ways to programmatially update the --ssh-key-id of a server.

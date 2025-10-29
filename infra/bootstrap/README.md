# Server Bootstrapper

This directory packages everything needed to provision a DigitalOcean droplet through a Dockerized helper script.

- `image/` – Docker build context containing `Dockerfile` and `entrypoint.sh`.
- `run.sh` – convenience script that builds the image and runs the container.
- `config.env` – environment-style configuration consumed by `run.sh`.

## Configure

Edit `config.env` to set the droplet parameters and credentials:

```env
IMAGE_NAME=bootstrap_dalhe
REGION=nyc1
IMAGE=ubuntu-24-04-x64
SSH_KEY=123456
SIZE=s-1vcpu-1gb
API_KEY=dop_v1_your_token
NAME=dalhe-bootstrap
```

`run.sh` validates that each variable is present before launching Docker.

## Build & Run via run.sh

```bash
cd infra/bootstrap
./run.sh
```

The script builds `IMAGE_NAME` from `image/` and executes the container, passing the values from `config.env` as flags to `entrypoint.sh`.

## Manual Workflow

If you prefer manual control:

```bash
docker build -t "${IMAGE_NAME}" infra/bootstrap/image
docker run -it "${IMAGE_NAME}" \
  --api-key "${API_KEY}" \
  --ssh-key "${SSH_KEY}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --size "${SIZE}" \
  --name "${NAME}"
```

Any flag you omit triggers interactive prompts inside the container. Keep your API key confidential—avoid committing real tokens.

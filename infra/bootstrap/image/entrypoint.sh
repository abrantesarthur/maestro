#!/bin/bash
set -e

# executes 'doctl compute' with the provided arguments to run computations on DigitalOcean
doctl_compute() {
  local -a args=("$@")                  # Store all function arguments as an array.
  local resource_name="${!#}"           # Get the *last* argument (resource name).
  unset 'args[${#args[@]}-1]'           # Remove that last argument from args array.

  local output
  if ! output=$(doctl compute "${args[@]}" 2>&1); then  # Run `doctl compute ...`, capture stdout+stderr.
    if printf '%s' "$output" | grep -q '403'; then      # If output contains "403" (permission denied):
      printf '❌ The provided DigitalOcean API key lacks permission to list %s. Please create a token with the required scopes and try again.\n' "$resource_name" >&2
    else                                                # Otherwise, print the actual error message.
      printf '%s\n' "$output" >&2
    fi
    exit 1                                              # Exit script with error status.
  fi

  printf '%s\n' "$output"                               # If successful, print the command’s output.
}

# Prompts the user to select from a list of provided DigitalOcean resources
select_doctl_resource() {
  local resource="$1"
  local prompt="$2"
  local resource_name="$3"
  local preselection="${4:-}"

  local valid_list
  valid_list=$(printf '%s\n' "$resource" | awk 'NR>1 {print $1}')

  if [[ -z "$valid_list" ]]; then
    printf '❌ No %s available. Please ensure they exist and try again.\n' "$resource_name" >&2
    exit 1
  fi

  local selection
  if [[ -n "$preselection" ]]; then
    if grep -Fxq "$preselection" <<< "$valid_list"; then
      printf '%s' "$preselection"
      return 0
    fi
    printf '❌ The provided %s "%s" is invalid.\n' "$resource_name" "$preselection" >&2
    exit 1
  fi

  printf '%s\n' "$resource" >&2

  read -p "$prompt " selection
  while true; do
    if grep -Fxq "$selection" <<< "$valid_list"; then
      printf '%s' "$selection"
      return 0
    fi
    read -p "$(printf '❌ Invalid %s. Please choose one from the list above: ' "$resource_name")" selection
  done
}

## try to read the arguments from the command-line
CLI_DOCTL_API_KEY=""
CLI_SSH_KEY=""
CLI_REGION=""
CLI_IMAGE=""
CLI_SIZE=""
CLI_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLI_SSH_KEY="$2"
      shift 2
      ;;
    --region)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLI_REGION="$2"
      shift 2
      ;;
    --image)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLI_IMAGE="$2"
      shift 2
      ;;
    --size|---size)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLI_SIZE="$2"
      shift 2
      ;;
    --name)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLI_NAME="$2"
      shift 2
      ;;
    --api-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLI_DOCTL_API_KEY="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done


printf '🚀 Dalhe.AI DigitalOcean Bootstrapper\n\n'

# Authenticate if not already valid
if ! doctl auth list 2>/dev/null | grep -q valid; then
  DOCTL_API_KEY="$CLI_DOCTL_API_KEY"
  while [[ -z "$DOCTL_API_KEY" ]]; do
    read -p "Enter DigitalOcean API key with scope to create droplets and list existing ssh-key IDS: " DOCTL_API_KEY
    if [[ -z "$DOCTL_API_KEY" ]]; then
      printf '❌ DigitalOcean API key cannot be empty. Please provide a valid key.\n' >&2
    fi
  done
  printf "🔑 Authenticating to DigitalOcean...\n"
  doctl auth init -t "$DOCTL_API_KEY" >/dev/null
fi

# Choose the public ssh key to bake into the droplet for allowing safe ssh connections
if [[ -n "$CLI_SSH_KEY" ]]; then
  printf '\n🔐 Validating the ssh-key "%s"...\n' "$CLI_SSH_KEY"
else
  echo "🔐 Available ssh-keys:"
fi
SSH_KEYS=$(doctl_compute ssh-key list --format ID,Name "SSH keys")
SSH_KEY=$(select_doctl_resource "$SSH_KEYS" "Enter the public ssh-key ID to connect to the droplet later:" "ssh-key ID" "$CLI_SSH_KEY")

# Choose the geographic region to create the droplet in
if [[ -n "$CLI_REGION" ]]; then
  printf '\n🌎 Validating the region "%s"..."\n' "$CLI_REGION"
else
  echo "🌎 Available droplet regions:"
fi
REGION_DATA=$(doctl_compute region list --format Slug,Name "droplet regions")
REGION=$(select_doctl_resource "$REGION_DATA" "Choose a region for the droplet:" "region slug" "$CLI_REGION")

# Choose the droplet's OS image
if [[ -n "$CLI_IMAGE" ]]; then
  printf '\n🖼️  Validating the droplet OS image "%s"...\n' "$CLI_IMAGE"
else
  echo "🖼️  Available droplet OS images:"
fi
IMAGE_DATA=$(doctl_compute image list-distribution --format Slug,Distribution "droplet OS images")
IMAGE=$(select_doctl_resource "$IMAGE_DATA" "Choose a OS image slug (e.g., ubuntu-24-04-x64):" "image slug" "$CLI_IMAGE")


# Choose the droplet's size
if [[ -n "$CLI_IMAGE" ]]; then
  printf '\n⚙️  Validating the droplet size "%s"...\n' "$CLI_IMAGE"
else
  echo "⚙️ Available droplet sizes:"
fi
SIZE_DATA=$(doctl compute size list --format Slug,Description,Memory,VCPUs,Disk,PriceMonthly | head -n 20)
SIZE=$(select_doctl_resource "$SIZE_DATA" "Choose a droplet size (e.g., s-1vcpu-1gb):" "droplet size" "$CLI_SIZE")


# Choose the droplet name
NAME="$CLI_NAME"
while [[ -z "$NAME" ]]; do
  echo
  read -p "Enter a droplet name: " NAME
  if [[ -z "$NAME" ]]; then
    printf '❌ Droplet name cannot be empty. Please provide a name.\n' >&2
  fi
done

printf "\n📦 Creating droplet...\n"
if ! create_output=$(doctl compute droplet create "$NAME" --region "$REGION" --image "$IMAGE" --size "$SIZE" --ssh-keys "$SSH_KEY" --wait --enable-monitoring --format PublicIPv4 2>&1); then
  error_lines=$(printf '%s\n' "$create_output" | grep -i '^error:')
  if [[ -z "$error_lines" ]]; then
    error_lines="$create_output"
  fi
  printf '\n❌ Failed to create droplet "%s". DigitalOcean responded with:\n%s\n' "$NAME" "$error_lines" >&2
  exit 1
fi

printf "\n✅ Droplet created successfully at:\n%s\n" "$create_output"

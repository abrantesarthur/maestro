# Runbook — Tearing down a managed Postgres cluster

Completely destroy a stack's managed database (`pg-<stack>`) so a full `maestro`
destroy can succeed. Irreversible once you reach step 3 — back up first.

The cluster is guarded by `protect` + `retainOnDelete`, so a plain `maestro`
destroy fails and Pulumi will never delete the cloud cluster for you. You delete
it by hand in DigitalOcean, drop it from Pulumi state, then destroy the rest.

**Order matters:** back up → delete cluster in DO → remove from Pulumi state →
`maestro` destroy. (Deleting the cluster before the VPC is mandatory — DO won't
delete a VPC with a live cluster member.)

## Prerequisites

- `doctl` authenticated (`doctl auth init`; token = `DIGITALOCEAN_ACCESS_TOKEN` from BWS).
- `pulumi` CLI + `PULUMI_ACCESS_TOKEN` from BWS.
- `pg_dump` / `pg_restore` (Postgres 16) if backing up.

Record the cluster ID:

```bash
CLUSTER_ID=$(doctl databases list --no-header --format ID,Name | awk '$2=="pg-<stack>"{print $1}')
echo "$CLUSTER_ID"
```

## 1. Back up the data (skip only if you truly don't need it)

Deleting the cluster also deletes its backups and PITR window. Take a portable
dump. The private endpoint resolves only inside the VPC, so either SSH into a
stack droplet, or temporarily trust your IP and use the public endpoint:

```bash
# Read the connection bundle (password is a secret):
cd pulumi/image
pulumi stack select <stack_name>
pulumi stack output postgres --show-secrets --json

# If dumping from your laptop, open the firewall to your IP:
MY_IP=$(curl -s https://ifconfig.me)
doctl databases firewalls append "$CLUSTER_ID" --rule "ip_addr:${MY_IP}"

pg_dump "postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=require" \
  -Fc -v -f "pg-<stack>-$(date +%Y%m%d%H%M).dump"
```

Copy the `.dump` to durable storage.

## 2. Delete the cloud cluster (irreversible)

```bash
doctl databases delete "$CLUSTER_ID"        # add --force to skip the prompt
doctl databases get "$CLUSTER_ID"           # expect a 404
```

## 3. Remove the cluster from Pulumi state

`pulumi state` only touches the checkpoint, so a throwaway dir works:

```bash
mkdir -p /tmp/maestro-teardown && cd /tmp/maestro-teardown
cat > Pulumi.yaml <<'EOF'
name: instrutoria
runtime: nodejs
EOF

export PULUMI_ACCESS_TOKEN=<from BWS>
pulumi login
pulumi stack select <stack_name>

# Find the URNs:
pulumi stack --show-urns | grep -Ei 'DatabaseCluster|ManagedDatabase'

# Unprotect the cluster, then delete the component subtree:
pulumi state unprotect 'urn:pulumi:<stack>::...:DatabaseCluster::pg-<stack>'
pulumi state delete   'urn:pulumi:<stack>::...:ManagedDatabase::pg-<stack>' --target-dependents

# Confirm gone (droplets/VPC/DNS must remain):
pulumi stack --show-urns | grep -Ei 'DatabaseCluster|ManagedDatabase|DatabaseDb|DatabaseUser' || echo "clean"
```

**No local pulumi?** Run the same commands inside the maestro image — it already
has `pulumi`, the program, and plugins. Override the entrypoint with `bash`
(the default entrypoint only does `up`/`destroy`):

```bash
docker build -t maestro_pulumi pulumi/image
docker run --rm -it -e PULUMI_ACCESS_TOKEN=$PULUMI_ACCESS_TOKEN \
  --entrypoint bash maestro_pulumi
#   inside the container — minimal Pulumi.yaml is enough for `pulumi state`:
cat > /workspace/Pulumi.yaml <<'EOF'
name: instrutoria
runtime: nodejs
EOF
cd /workspace && pulumi login && pulumi stack select <stack_name>
#   ...then the same unprotect / state delete / confirm commands above.
```

## 4. Destroy the rest of the stack

Prevent re-provisioning: in `maestro.yaml` set the stack's
`database.enabled: false`. Then set `pulumi.command: destroy` and run:

```bash
bun index.ts
```

`maestro` destroys **every** stack under `pulumi.stacks` — trim that list to
`<stack>` if you only mean one. Set `pulumi.command` back to `up` when done.

## 5. Verify

```bash
doctl databases list            # pg-<stack> absent
doctl vpcs list                 # vpc-<stack> absent
doctl compute droplet list      # stack droplets absent
pulumi stack --show-urns        # only what you intend to keep
```

## Restoring from a dump

```bash
pg_restore -h <new-host> -p <port> -U <new-user> -d <database> \
  --no-owner --no-privileges -v "pg-<stack>-<ts>.dump"
```

Add `?sslmode=require` (or `PGSSLMODE=require`) for TLS targets like DO.

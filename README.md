# backend

## Nginx configuration deployment

The repository keeps only the nginx files that differ from the defaults:

- infra/nginx/nginx.conf for the global daemon settings.
- infra/nginx/sites-available/dalhe.ai.conf for the site vhost.

There is a helper script to push those files to the droplet and reload nginx safely:

```bash
export REMOTE_HOST=your.droplet.ip
# optional
# export REMOTE_USER=deploy
# export SSH_OPTS="-i ~/.ssh/digitalocean"

infra/scripts/deploy-nginx.sh
```

The script will rsync the tracked config files, back up the existing copies, ensure the
sites-enabled symlink points at the tracked vhost, run `nginx -t`, and reload the
service. Afterwards, spot-check with:

```bash
ssh ${REMOTE_USER:-root}@${REMOTE_HOST} sudo nginx -T | grep dalhe.ai
curl -I https://dalhe.ai/
```

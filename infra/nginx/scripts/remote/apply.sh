#!/usr/bin/env bash
# Applies staged nginx configuration files on the remote host.
# Expects REMOTE_STAGING_DIR, REMOTE_TARGET_DIR, NGINX_CONFIG, and NGINX_SITES_CONFIG to be set.
# Fail fast on the remote host.
set -euo pipefail

backup_suffix="${backup_suffix:-~}"
remote_staging_dir="${REMOTE_STAGING_DIR:?REMOTE_STAGING_DIR missing}"
remote_target_dir="${REMOTE_TARGET_DIR:?REMOTE_TARGET_DIR missing}"
nginx_config="${NGINX_CONFIG:?NGINX_CONFIG missing}"
# Split the space-delimited sites configuration list received via env vars.
IFS=' ' read -r -a nginx_sites_conf <<< "${NGINX_SITES_CONFIG:-}"

# Restores the previous nginx configuration if validation fails.
rollback() {
  echo "[REMOTE SERVER] - nginx validation failed; restoring previous configuration" >&2
  if [[ -f "${remote_target_dir}/${nginx_config}${backup_suffix}" ]]; then
    mv -f "${remote_target_dir}/${nginx_config}${backup_suffix}" "${remote_target_dir}/${nginx_config}"
  fi
  for site_conf in "${nginx_sites_conf[@]}"; do
    relative_path="sites-available/${site_conf}"
    if [[ -f "${remote_target_dir}/${relative_path}${backup_suffix}" ]]; then
      mv -f "${remote_target_dir}/${relative_path}${backup_suffix}" "${remote_target_dir}/${relative_path}"
    fi
  done
}

# Copy the configuration files from the stagign to target directory and create the required symlinks.
echo "[REMOTE SERVER] - copying ${nginx_config} from ${remote_staging_dir} to ${remote_target_dir}..."
install -b -S "${backup_suffix}" -m 0644 "${remote_staging_dir}/${nginx_config}" "${remote_target_dir}/${nginx_config}"
for site_conf in "${nginx_sites_conf[@]}"; do
  relative_path="sites-available/${site_conf}"
  echo "[REMOTE SERVER] - copying ${relative_path} from ${remote_staging_dir} to ${remote_target_dir}..."
  install -b -S "${backup_suffix}" -m 0644 "${remote_staging_dir}/${relative_path}" "${remote_target_dir}/${relative_path}"
  echo "[REMOTE SERVER] - creating symbolic link to ${remote_target_dir}/sites-enabled/${site_conf}..."
  ln -sf "${remote_target_dir}/${relative_path}" "${remote_target_dir}/sites-enabled/${site_conf}"
done

# Validate the new configuration before reloading nginx.
echo "[REMOTE SERVER] - Checking the syntax of the nginx configuration files..."
if ! nginx -t; then
  rollback
  exit 1
fi

# Reload nginx to activate the new configuration.
echo "[REMOTE SERVER] - Reloading nginx with new configuration..."
systemctl reload nginx


# Remove the backups created by install after a successful reload.
echo "[REMOTE SERVER] - Purging old backed up nginx configuration files..."
if [[ -f "${remote_target_dir}/${nginx_config}${backup_suffix}" ]]; then
  rm -f "${remote_target_dir}/${nginx_config}${backup_suffix}"
fi
for site_conf in "${nginx_sites_conf[@]}"; do
  relative_path="sites-available/${site_conf}"
  if [[ -f "${remote_target_dir}/${relative_path}${backup_suffix}" ]]; then
    rm -f "${remote_target_dir}/${relative_path}${backup_suffix}"
  fi
done

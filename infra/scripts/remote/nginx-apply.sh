#!/usr/bin/env bash
# Fail fast on the remote host.
set -euo pipefail

backup_suffix="${backup_suffix:-~}"
server_staging_dir="${SERVER_STAGING_DIR:?SERVER_STAGING_DIR missing}"
target_dir="${TARGET_DIR:?TARGET_DIR missing}"
nginx_config="${NGINX_CONFIG:?NGINX_CONFIG missing}"
IFS=' ' read -r -a nginx_sites_conf <<< "${NGINX_SITES_CONFIG:-}"


rollback() {
  echo "[REMOTE SERVER] - nginx validation failed; restoring previous configuration" >&2
  if [[ -f "${target_dir}/${nginx_config}${backup_suffix}" ]]; then
    sudo mv -f "${target_dir}/${nginx_config}${backup_suffix}" "${target_dir}/${nginx_config}"
  fi
  for site_conf in "${nginx_sites_conf[@]}"; do
    relative_path="sites-available/${site_conf}"
    if [[ -f "${target_dir}/${relative_path}${backup_suffix}" ]]; then
      sudo mv -f "${target_dir}/${relative_path}${backup_suffix}" "${target_dir}/${relative_path}"
    fi
  done
}

echo "[REMOTE SERVER] - copying ${nginx_config} from ${server_staging_dir} to ${target_dir}..."
install -b -S "${backup_suffix}" -m 0644 "${server_staging_dir}/${nginx_config}" "${target_dir}/${nginx_config}"
for site_conf in "${nginx_sites_conf[@]}"; do
  relative_path="sites-available/${site_conf}"
  echo "[REMOTE SERVER] - copying ${relative_path} from ${server_staging_dir} to ${target_dir}..."
  sudo install -b -S "${backup_suffix}" -m 0644 "${server_staging_dir}/${relative_path}" "${target_dir}/${relative_path}"
  echo "[REMOTE SERVER] - creating symbolic link to ${target_dir}/sites-enabled/${site_conf}..."
  sudo ln -sf "${target_dir}/${relative_path}" "${target_dir}/sites-enabled/${site_conf}"
done

echo "[REMOTE SERVER] - Checking the syntax of the nginx configuration files..."
if ! sudo nginx -t; then
  rollback
  exit 1
fi

echo "[REMOTE SERVER] - Reloading nginx with new configuration..."
sudo systemctl reload nginx


echo "[REMOTE SERVER] - Purging old backed up nginx configuration files..."
if [[ -f "${target_dir}/${nginx_config}${backup_suffix}" ]]; then
  sudo rm -f "${target_dir}/${nginx_config}${backup_suffix}"
fi
for site_conf in "${nginx_sites_conf[@]}"; do
  relative_path="sites-available/${site_conf}"
  if [[ -f "${target_dir}/${relative_path}${backup_suffix}" ]]; then
    sudo rm -f "${target_dir}/${relative_path}${backup_suffix}"
  fi
done
#!/usr/bin/env python3

"""Dynamic inventory that maps SSH_HOSTS into Ansible hosts and tag-based groups.

Usage:
  Export SSH_HOSTS with a single-line JSON list of hostname, tags, effectiveDomain, optional groups, and optional per-host Postgres connection details before invoking Ansible.
  Example: {"hosts":[{"hostname":"ssh0.dev.dalhe.ai","tags":["backend","dev","web"],"effectiveDomain":"dev.dalhe.ai","groups":["devops"],"postgresHost":"private-db.example.com","postgresPort":"25060","postgresPassword":"<secret>"}]}

  The 'groups' field is optional and specifies per-host system groups override for the groups role.
  If not specified, the host uses the global MANAGED_GROUPS environment variable.

  The 'effectiveDomain' field specifies the environment-specific domain for nginx configuration
  (e.g., dev.example.com for dev, staging.example.com for staging, example.com for prod).

  The 'postgresHost', 'postgresPort', and 'postgresPassword' fields are optional and carry the
  per-stack Postgres connection details.
  They are stamped only onto the backend-tagged host(s) of a DB-enabled stack, so each stack's
  backend points at its own isolated database.
  The stable POSTGRES_USER/DB and the constant SSLMODE values travel globally via BACKEND_ENV_* instead.

  Inventory output shape (for the example above):
    {
      "all": {"hosts": ["ssh0.dev.dalhe.ai"], "vars": {"ansible_python_interpreter": "/usr/bin/python3"}},
      "_meta": {"hostvars": {"ssh0.dev.dalhe.ai": {"ansible_host": "ssh0.dev.dalhe.ai", "ansible_user": "root", "ansible_port": "22", "ansible_ssh_private_key_file": "<key>", "ansible_ssh_common_args": "<cloudflared-proxy>", "host_managed_groups": ["devops"], "effective_domain": "dev.dalhe.ai", "postgres_host": "private-db.example.com", "postgres_port": "25060", "postgres_password": "<secret>"}}},
      "backend": {"hosts": ["ssh0.dev.dalhe.ai"]},
      "dev": {"hosts": ["ssh0.dev.dalhe.ai"]},
      "web": {"hosts": ["ssh0.dev.dalhe.ai"]}
    }
"""

from __future__ import annotations

import json
import os
import sys
from typing import Dict, List, Set, TypedDict


class HostEntry(TypedDict, total=False):
    hostname: str
    tags: List[str]
    effectiveDomain: str  # Environment-specific domain (e.g., dev.example.com)
    groups: List[str]  # Optional per-host groups override
    postgresHost: str  # Optional per-stack Postgres private endpoint host (DO-generated)
    postgresPort: str  # Optional per-stack Postgres cluster port (DO-assigned)
    postgresPassword: str  # Optional per-stack Postgres app-user password (DO-generated secret)
    postgresAdminUser: str  # Optional cluster admin (doadmin) user
    postgresAdminPassword: str  # Optional cluster admin (doadmin) password (secret)


def parse_hosts() -> List[HostEntry]:
    hosts_arg = os.environ.get("SSH_HOSTS", "").strip()
    if not hosts_arg:

        sys.stderr.write(
            f"SSH_HOSTS {hosts_arg} must be set with a single-line JSON object or array containing hosts and tags.\n"
        )
        sys.exit(1)

    try:
        parsed_hosts = json.loads(hosts_arg)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"Invalid SSH_HOSTS JSON: {exc}\n")
        sys.exit(1)

    # allow passing either {"hosts": [...]} or directly [...]
    if isinstance(parsed_hosts, dict):
        hosts_list = parsed_hosts.get("hosts")
    else:
        hosts_list = parsed_hosts

    if not isinstance(hosts_list, list) or not hosts_list:
        sys.stderr.write("SSH_HOSTS must contain a non-empty 'hosts' array.\n")
        sys.exit(1)

    normalized_hosts: List[HostEntry] = []
    for idx, host_entry in enumerate(hosts_list):
        if not isinstance(host_entry, dict):
            sys.stderr.write(f"Host entry at index {idx} is not an object.\n")
            sys.exit(1)

        hostname = host_entry.get("hostname")
        if not isinstance(hostname, str) or not hostname.strip():
            sys.stderr.write(f"Host entry at index {idx} is missing a valid 'hostname'.\n")
            sys.exit(1)

        raw_tags = host_entry.get("tags", [])
        if raw_tags is None:
            raw_tags = []
        if not isinstance(raw_tags, list):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'tags' section.\n")
            sys.exit(1)

        tags: List[str] = []
        for tag in raw_tags:
            if not isinstance(tag, str) or not tag.strip():
                sys.stderr.write(f"Host entry for {hostname} has an invalid tag: {tag!r}\n")
                sys.exit(1)
            tags.append(tag.strip())

        # Parse optional per-host groups override
        raw_groups = host_entry.get("groups")
        groups: List[str] | None = None
        if raw_groups is not None:
            if not isinstance(raw_groups, list):
                sys.stderr.write(f"Host entry for {hostname} has an invalid 'groups' section.\n")
                sys.exit(1)
            groups = []
            for group in raw_groups:
                if not isinstance(group, str) or not group.strip():
                    sys.stderr.write(f"Host entry for {hostname} has an invalid group: {group!r}\n")
                    sys.exit(1)
                groups.append(group.strip())

        # Parse effectiveDomain for nginx configuration
        effective_domain = host_entry.get("effectiveDomain")
        if effective_domain is not None and not isinstance(effective_domain, str):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'effectiveDomain' (must be a string).\n")
            sys.exit(1)

        # Parse optional per-stack Postgres connection details (DO-generated)
        postgres_host = host_entry.get("postgresHost")
        if postgres_host is not None and not isinstance(postgres_host, str):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'postgresHost' (must be a string).\n")
            sys.exit(1)

        postgres_port = host_entry.get("postgresPort")
        if postgres_port is not None and not isinstance(postgres_port, str):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'postgresPort' (must be a string).\n")
            sys.exit(1)

        postgres_password = host_entry.get("postgresPassword")
        if postgres_password is not None and not isinstance(postgres_password, str):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'postgresPassword' (must be a string).\n")
            sys.exit(1)

        postgres_admin_user = host_entry.get("postgresAdminUser")
        if postgres_admin_user is not None and not isinstance(postgres_admin_user, str):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'postgresAdminUser' (must be a string).\n")
            sys.exit(1)

        postgres_admin_password = host_entry.get("postgresAdminPassword")
        if postgres_admin_password is not None and not isinstance(postgres_admin_password, str):
            sys.stderr.write(f"Host entry for {hostname} has an invalid 'postgresAdminPassword' (must be a string).\n")
            sys.exit(1)

        host_entry_normalized: HostEntry = {
            "hostname": hostname.strip(),
            "tags": sorted(set(tags)),
        }
        if groups is not None:
            host_entry_normalized["groups"] = groups
        if effective_domain is not None:
            host_entry_normalized["effectiveDomain"] = effective_domain.strip()
        if postgres_host is not None:
            host_entry_normalized["postgresHost"] = postgres_host.strip()
        if postgres_port is not None:
            host_entry_normalized["postgresPort"] = postgres_port.strip()
        if postgres_password is not None:
            host_entry_normalized["postgresPassword"] = postgres_password
        if postgres_admin_user is not None:
            host_entry_normalized["postgresAdminUser"] = postgres_admin_user.strip()
        if postgres_admin_password is not None:
            host_entry_normalized["postgresAdminPassword"] = postgres_admin_password

        normalized_hosts.append(host_entry_normalized)

    return normalized_hosts


def build_inventory(hosts: List[HostEntry]) -> Dict[str, Dict[str, dict]]:
    ssh_key = os.environ.get("SSH_KEY_PATH", "").strip()
    hostvars: Dict[str, dict] = {}
    tag_groups: Dict[str, Set[str]] = {}
    for host_entry in hosts:
        host = host_entry["hostname"]
        # proxy ssh commands through the cloudflared client so we can connect to the tunnel
        ssh_common_args = (
            f'-o ProxyCommand="/usr/local/bin/cloudflared access ssh --hostname {host}" '
            f'-o IdentityFile={ssh_key}'
        )
        host_vars: dict = {
            "ansible_host": host,
            "ansible_user": "root",
            "ansible_port":  "22",
            "ansible_ssh_private_key_file": ssh_key,
            "ansible_ssh_common_args": ssh_common_args,
        }
        # Pass per-host groups override if specified
        if "groups" in host_entry:
            host_vars["host_managed_groups"] = host_entry["groups"]
        # Pass effective domain for nginx configuration
        if "effectiveDomain" in host_entry:
            host_vars["effective_domain"] = host_entry["effectiveDomain"]
        # Pass per-stack Postgres connection details for the backend container env
        if "postgresHost" in host_entry:
            host_vars["postgres_host"] = host_entry["postgresHost"]
        if "postgresPort" in host_entry:
            host_vars["postgres_port"] = host_entry["postgresPort"]
        if "postgresPassword" in host_entry:
            host_vars["postgres_password"] = host_entry["postgresPassword"]
        if "postgresAdminUser" in host_entry:
            host_vars["postgres_admin_user"] = host_entry["postgresAdminUser"]
        if "postgresAdminPassword" in host_entry:
            host_vars["postgres_admin_password"] = host_entry["postgresAdminPassword"]
        hostvars[host] = host_vars
        for tag in host_entry.get("tags", []):
            tag_groups.setdefault(tag, set()).add(host)

    # generate groups for each provided tag pointing to the hosts that declared it
    inventory_groups: Dict[str, Dict[str, List[str]]] = {
        tag: {"hosts": sorted(host_list)} for tag, host_list in tag_groups.items()
    }

    inventory = {
        "all": {
            "hosts": sorted(hostvars.keys()),
            "vars": {"ansible_python_interpreter": "/usr/bin/python3"},
        },
        "_meta": {"hostvars": hostvars},
    }
    inventory.update(inventory_groups)
    return inventory


def main() -> None:
    hosts = parse_hosts()
    inventory = build_inventory(hosts)
    print(json.dumps(inventory))


if __name__ == "__main__":
    main()

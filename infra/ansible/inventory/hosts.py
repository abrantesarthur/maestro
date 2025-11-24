#!/usr/bin/env python3

"""Dynamic inventory that maps SSH_HOSTS into Ansible hosts and tag-based groups.

Usage:
  Export SSH_HOSTS with a single-line JSON list of hostname and tags before invoking Ansible.
  Example: {"hosts":[{"hostname":"ssh0.dalhe.ai","tags":["backend","prod","web"]}]}

  Inventory output shape (for the example above):
    {d
      "all": {"hosts": ["ssh0.dalhe.ai"], "vars": {"ansible_python_interpreter": "/usr/bin/python3"}},
      "_meta": {"hostvars": {"ssh0.dalhe.ai": {"ansible_host": "ssh0.dalhe.ai", "ansible_user": "root", "ansible_port": "22", "ansible_ssh_private_key_file": "<key>", "ansible_ssh_common_args": "<cloudflared-proxy>"}}},
      "backend": {"hosts": ["ssh0.dalhe.ai"]},
      "prod": {"hosts": ["ssh0.dalhe.ai"]},
      "web": {"hosts": ["ssh0.dalhe.ai"]}
    }
"""

from __future__ import annotations

import json
import os
import sys
from typing import Dict, List, Set, TypedDict


class HostEntry(TypedDict):
    hostname: str
    tags: List[str]


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

        normalized_hosts.append(
            {
                "hostname": hostname.strip(),
                "tags": sorted(set(tags)),
            }
        )

    return normalized_hosts


def build_inventory(hosts: List[HostEntry]) -> Dict[str, Dict[str, dict]]:
    ssh_key = os.environ.get("SSH_KEY_PATH", "").strip()
    hostvars: Dict[str, dict] = {}
    groups: Dict[str, Set[str]] = {}
    for host_entry in hosts:
        host = host_entry["hostname"]
        # proxy ssh commands through the cloudflared client so we can connect to the tunnel
        ssh_common_args = (
            f'-o ProxyCommand="/usr/local/bin/cloudflared access ssh --hostname {host}" '
            f'-o IdentityFile={ssh_key}'
        )
        hostvars[host] = {
            "ansible_host": host,
            "ansible_user": "root",
            "ansible_port":  "22",
            "ansible_ssh_private_key_file": ssh_key,
            "ansible_ssh_common_args": ssh_common_args,
        }
        for tag in host_entry.get("tags", []):
            groups.setdefault(tag, set()).add(host)

    # generate groups for each provided tag pointing to the hosts that declared it
    inventory_groups: Dict[str, Dict[str, List[str]]] = {
        tag: {"hosts": sorted(host_list)} for tag, host_list in groups.items()
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

#!/usr/bin/env python3

"""Dynamic inventory that maps SSH_HOSTNAMES into Ansible hosts.

Usage:
  Export SSH_HOSTNAMES with a comma- or whitespace-separated list
  (e.g., "ssh-a.dalhe.ai,ssh-b.dalhe.ai") before invoking Ansible.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Dict, List


def parse_hosts() -> List[str]:
    hosts_arg = os.environ.get("SSH_HOSTNAMES", "").strip()
    if not hosts_arg:
        sys.stderr.write(
            "SSH_HOSTNAMES must be set with one or more hostnames "
            "(comma- or whitespace-separated).\n"
        )
        sys.exit(1)

    separators_trans = str.maketrans({",": " ", "\n": " ", "\t": " "})
    normalized = hosts_arg.translate(separators_trans)
    hosts = [token for token in normalized.split(" ") if token]
    if not hosts:
        sys.stderr.write(
            "SSH_HOSTNAMES did not contain any usable hostnames.\n"
        )
        sys.exit(1)

    return hosts


def build_inventory(hosts: List[str]) -> Dict[str, Dict[str, dict]]:
    ssh_key = os.environ.get("SSH_KEY_PATH", "").strip()
    hostvars: Dict[str, dict] = {}
    for host in hosts:
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

    return {
        "all": {
            "hosts": hosts,
            "vars": {"ansible_python_interpreter": "/usr/bin/python3"},
        },
        "_meta": {"hostvars": hostvars},
    }


def main() -> None:
    hosts = parse_hosts()
    inventory = build_inventory(hosts)

    if len(sys.argv) == 2 and sys.argv[1] == "--list":
        print(json.dumps(inventory))
    elif len(sys.argv) == 3 and sys.argv[1] == "--host":
        host = sys.argv[2]
        host_vars = inventory["_meta"]["hostvars"].get(host, {})
        print(json.dumps(host_vars))
    else:
        # Default to --list behavior so tools that omit the flag still work.
        print(json.dumps(inventory))


if __name__ == "__main__":
    main()

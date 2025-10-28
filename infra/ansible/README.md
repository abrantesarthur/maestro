## Ansible Navigator

- Install it locally. Must have python3 and pip installed.
- run `ansible-navigator run playbooks/groups.yml` to provision groups
- The ssh command within ansible_ee container expects infra.dalhe.ai's private key at /root/.ssh/infra_dalhe_ai as specified by ansible/execution_environment/files/ssh_config
- When running ansible at via the execution-environment's image, we must mount the private key at that path!

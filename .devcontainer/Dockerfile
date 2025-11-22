# Uses Microsoft’s Dev Containers base image with preinstalled
# tooling (e.g., git, sudo, curl, etc.)
FROM mcr.microsoft.com/devcontainers/base:ubuntu

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"


# refreshes package lists.
RUN apt-get update
# install curl, ca-certificates and docker cli
RUN apt-get install -y curl ca-certificates docker-cli

# runs Bun’s official installer, which installs to BUN_INSTALL
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.1"
# creates a symlink in /usr/local/bin so bun is on the global path for all users.
RUN ln -s ${BUN_INSTALL}/bin/bun /usr/local/bin/bun
# gives ownership of the Bun files to the non-root vscode user, preventing permission issues.
RUN chown -R vscode:vscode ${BUN_INSTALL}

# clean up cached package data to reduce image size.
RUN rm -rf /var/lib/apt/lists/*

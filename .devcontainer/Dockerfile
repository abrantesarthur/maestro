# Uses Microsoft’s Dev Containers base image with preinstalled tooling
FROM mcr.microsoft.com/devcontainers/base:ubuntu

# refresh package lists + install deps
RUN apt-get update && \
    apt-get install -y curl ca-certificates docker-cli && \
    update-ca-certificates

###############################
# Install Bitwarden BWS CLI (used to retrieve secrets)   #
###############################
ARG BWS_VERSION="1.0.0"
ARG BWS_ARCH="bws-x86_64-unknown-linux-gnu"
RUN curl -fsSL \
      "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/${BWS_ARCH}-${BWS_VERSION}.zip" \
      -o /tmp/bws.zip \
  && unzip /tmp/bws.zip -d /tmp/bws \
  && install /tmp/bws/bws /usr/local/bin/bws \
  && rm -rf /tmp/bws /tmp/bws.zip

# FIXME: install yq

# cleanup
RUN rm -rf /var/lib/apt/lists/*


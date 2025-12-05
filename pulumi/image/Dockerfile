FROM ubuntu:25.10

# install curl, unzip, nodejs, sudo, and ssh client
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        unzip \
        nodejs \
        npm \
        wget \
        sudo \
        openssh-client \
    && rm -rf /var/lib/apt/lists/*

# install pulumi
RUN curl -fsSL https://get.pulumi.com | sh

# install doctl and add it to the path
RUN cd ~ && \
    wget https://github.com/digitalocean/doctl/releases/download/v1.146.0/doctl-1.146.0-linux-amd64.tar.gz && \
    tar xf doctl-1.146.0-linux-amd64.tar.gz && \
    mv doctl /usr/local/bin

# add pulumi to the path
ENV PATH="/root/.pulumi/bin:${PATH}"

WORKDIR /workspace

# copy the project files into the container
COPY package.json package-lock.json Pulumi.yaml tsconfig.json index.ts ./
COPY resources ./resources
COPY commands ./commands
COPY providers ./providers

# install the Node packages
RUN npm install

# copy the entrypoint into the image
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]

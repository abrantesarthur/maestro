FROM ubuntu:25.10

# install doctl
RUN apt-get update && apt-get install -y wget
RUN cd ~
RUN wget https://github.com/digitalocean/doctl/releases/download/v1.146.0/doctl-1.146.0-linux-amd64.tar.gz
RUN tar xf doctl-1.146.0-linux-amd64.tar.gz
RUN mv doctl /usr/local/bin

# Copy the bootstrap script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
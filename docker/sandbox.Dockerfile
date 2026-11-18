FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git zip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Run as a normal user, not root.
RUN useradd -m agent && mkdir /workspace && chown agent /workspace
USER agent
WORKDIR /workspace

#!/usr/bin/env bash
# One-time server setup (Ubuntu, run as root). Safe to run again.
#   bash setup.sh "<CI ssh public key>" "<caddy password hash>"
# Expects deploy/cloud-agent.service and deploy/Caddyfile.block next to this file.
set -euo pipefail
cd "$(dirname "$0")"
CI_KEY="$1"
HASH="$2"

apt-get install -y docker.io rsync

id cloudagent >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker cloudagent
install -d -o cloudagent -g cloudagent /opt/cloud-agent

# The server's pnpm is a corepack shim that tries to download a newer pnpm, so install a fixed one.
su cloudagent -c "export PATH=/opt/node22/bin:\$PATH; npm i -g pnpm@10 --prefix /home/cloudagent/.local"

# CI logs in as cloudagent with its own key, and may only restart this one service.
install -d -m 700 -o cloudagent -g cloudagent /home/cloudagent/.ssh
echo "$CI_KEY" > /home/cloudagent/.ssh/authorized_keys
chown cloudagent:cloudagent /home/cloudagent/.ssh/authorized_keys
chmod 600 /home/cloudagent/.ssh/authorized_keys
echo 'cloudagent ALL=(root) NOPASSWD: /usr/bin/systemctl restart cloud-agent' > /etc/sudoers.d/cloud-agent
chmod 440 /etc/sudoers.d/cloud-agent

install -m 644 cloud-agent.service /etc/systemd/system/cloud-agent.service
systemctl daemon-reload
systemctl enable cloud-agent

# Add our site to Caddy once. Back up first, and put the old file back if the new one is invalid.
if ! grep -q '^agent.priyanshuu.xyz' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-before-agent"
  { echo; sed "s|__PASSWORD_HASH__|$HASH|" Caddyfile.block; } >> /etc/caddy/Caddyfile
  if caddy validate --config /etc/caddy/Caddyfile; then
    systemctl reload caddy
  else
    cp /etc/caddy/Caddyfile.bak-before-agent /etc/caddy/Caddyfile
    echo "Caddy config was invalid, restored the old one." >&2
    exit 1
  fi
fi

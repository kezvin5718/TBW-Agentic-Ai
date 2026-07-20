#!/bin/bash
set -e

echo "🚀 TBW OS VPS SETUP: Initializing Ubuntu 24 Server Setup..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install prerequisite packages
sudo apt install -y curl apt-transport-https ca-certificates gnupg lsb-release

# Install Docker GPG key and repository
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine & Compose Plugin
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Enable and start Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Install Caddy natively
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y

# Stop & disable native caddy to prevent port 80/443 conflicts with the Docker Compose container version
sudo systemctl stop caddy || true
sudo systemctl disable caddy || true

# Configure UFW firewall
echo "🔒 Configuring UFW Firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw --force enable

echo "✅ Ubuntu VPS setup successfully completed!"
echo "Docker and Caddy installed. UFW configured (Ports 22, 80, 443 open)."

#!/bin/bash
set -e

echo "🚀 REDEPLOYING TBW OPERATIONS SYSTEM..."

# 1. Pull latest code from main branch
echo "📥 Fetching latest codebase changes..."
git pull origin main

# 2. Build the Docker images
echo "🏗️ Building standalone Next.js docker containers..."
docker compose build --pull

# 3. Spin up/restart the services
echo "⚡ Restarting container services in detached mode..."
docker compose up -d

# 4. Wait for application startup
echo "⏳ Waiting 10 seconds for service boot..."
sleep 10

# 5. Check Health Check endpoint
echo "🏥 Performing health audit check via Caddy..."
HEALTH_RESULT=$(curl -k -s https://localhost/api/health || curl -s http://localhost/api/health)

echo "📊 Health Check Status Response:"
echo "$HEALTH_RESULT"

echo "✅ Redeployment completed successfully!"

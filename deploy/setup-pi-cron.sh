#!/bin/bash
# One-time setup: clones the repo on the Pi and installs the auto-deploy cron job.
# Run on the Pi: bash setup-pi-cron.sh <GITHUB_REPO_URL>
#
# Example:
#   bash setup-pi-cron.sh https://github.com/youruser/bus80.git

set -e

REPO_URL="${1:?Usage: bash setup-pi-cron.sh <GITHUB_REPO_URL>}"
DEPLOY_DIR="/root/bus80"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Setting up Pi auto-deploy from GitHub"

# Clone or update the repo
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "==> Repository already exists at $DEPLOY_DIR, pulling latest..."
  cd "$DEPLOY_DIR"
  git pull origin main
else
  echo "==> Cloning repository..."
  git clone "$REPO_URL" "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

# Ensure the deploy script is executable
chmod +x "$DEPLOY_DIR/deploy/pi-autodeploy.sh"

# Create log file
touch /var/log/bus80-deploy.log

# Install cron job (every 5 minutes)
CRON_CMD="*/5 * * * * $DEPLOY_DIR/deploy/pi-autodeploy.sh"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "pi-autodeploy.sh"; then
  echo "==> Cron job already installed, updating..."
  crontab -l 2>/dev/null | grep -v "pi-autodeploy.sh" | { cat; echo "$CRON_CMD"; } | crontab -
else
  echo "==> Installing cron job..."
  (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
fi

# Do an initial build
echo "==> Running initial build..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

echo ""
echo "==> Setup complete!"
echo ""
echo "  Deploy dir:  $DEPLOY_DIR"
echo "  Cron:        Every 5 minutes polls GitHub for new commits"
echo "  Log:         /var/log/bus80-deploy.log"
echo ""
echo "  The Pi will automatically deploy when you push to main on GitHub."
echo "  Manual deploy: bash $DEPLOY_DIR/deploy/pi-autodeploy.sh"
echo ""

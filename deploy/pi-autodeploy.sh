#!/bin/bash
# Pi auto-deploy: polls GitHub origin/main and deploys if new commits detected.
# Installed as a cron job by setup-pi-cron.sh — runs every 5 minutes.

set -e

DEPLOY_DIR="/root/bus80"
LOG_FILE="/var/log/bus80-deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Ensure deploy directory exists and is a git clone
if [ ! -d "$DEPLOY_DIR/.git" ]; then
  log "ERROR: $DEPLOY_DIR is not a git repository. Run setup-pi-cron.sh first."
  exit 1
fi

cd "$DEPLOY_DIR"

# Fetch latest from origin
git fetch origin main --quiet 2>> "$LOG_FILE"

# Compare local HEAD with origin/main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  # No new commits, nothing to do
  exit 0
fi

log "New commits detected: $LOCAL -> $REMOTE"
log "Deploying..."

# Pull latest changes
git reset --hard origin/main >> "$LOG_FILE" 2>&1

# Rebuild and restart containers
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d >> "$LOG_FILE" 2>&1

# Clean up old images
docker image prune -f >> "$LOG_FILE" 2>&1

log "Deploy complete! Now at $(git rev-parse --short HEAD)"

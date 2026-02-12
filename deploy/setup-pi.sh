#!/bin/bash
# One-time setup: creates a bare git repo with a post-receive hook for auto-deploy.
# Run on the Pi: bash setup-pi.sh

set -e

REPO_NAME="bus80"
BARE_REPO="/root/${REPO_NAME}.git"
DEPLOY_DIR="/root/${REPO_NAME}"

echo "==> Setting up bus80 deployment"

# Create bare git repo for push-to-deploy
if [ ! -d "$BARE_REPO" ]; then
    echo "==> Creating bare git repository..."
    mkdir -p "$BARE_REPO"
    git init --bare "$BARE_REPO"
fi

# Create deploy directory
mkdir -p "$DEPLOY_DIR"

# Install the post-receive hook
echo "==> Installing post-receive hook..."
cat > "$BARE_REPO/hooks/post-receive" << 'HOOK'
#!/bin/bash
set -e

DEPLOY_DIR="/root/bus80"
REPO_DIR="/root/bus80.git"

echo "==> Deploying bus80..."

git --work-tree="$DEPLOY_DIR" --git-dir="$REPO_DIR" checkout -f main

cd "$DEPLOY_DIR"

echo "==> Building and starting containers..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

docker image prune -f

echo "==> Deploy complete!"
HOOK
chmod +x "$BARE_REPO/hooks/post-receive"

echo ""
echo "==> Setup complete!"
echo ""
echo "On your development machine, add the Pi as a remote:"
echo ""
echo "  git remote add pi root@<PI_IP_ADDRESS>:bus80.git"
echo ""
echo "Then deploy with:"
echo ""
echo "  git push pi main"
echo ""

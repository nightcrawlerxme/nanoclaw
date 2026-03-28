#!/bin/bash
# Wait for Docker to be ready before starting NanoClaw

DOCKER_SOCK="${DOCKER_HOST:-$HOME/.docker/run/docker.sock}"
# Strip leading unix:// prefix if present (e.g. DOCKER_HOST=unix:///var/run/docker.sock)
DOCKER_SOCK="${DOCKER_SOCK#unix://}"
MAX_WAIT=120
ELAPSED=0

DOCKER_CMD="${DOCKER_CMD:-$(command -v docker || echo /usr/local/bin/docker)}"

# Launch Docker Desktop if not running (macOS only)
if ! "$DOCKER_CMD" info &>/dev/null; then
    if command -v open &>/dev/null; then
        open -a Docker
    fi
fi

# Wait for Docker socket to be available
while [ ! -S "$DOCKER_SOCK" ] || ! "$DOCKER_CMD" info &>/dev/null; do
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo "$(date): Timed out waiting for Docker" >&2
        exit 1
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

echo "$(date): Docker ready after ${ELAPSED}s, starting NanoClaw"
NODE_CMD="${NODE_CMD:-$(command -v node || echo node)}"
exec "$NODE_CMD" "$HOME/NanoClaw/dist/index.js"

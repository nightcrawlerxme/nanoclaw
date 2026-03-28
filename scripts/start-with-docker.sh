#!/bin/bash
# Wait for Docker to be ready before starting NanoClaw

DOCKER_SOCK_CHECK=true
if [ -n "$DOCKER_HOST" ]; then
    case "$DOCKER_HOST" in
        unix://*) DOCKER_SOCK="${DOCKER_HOST#unix://}" ;;
        tcp://*|http://*) DOCKER_SOCK_CHECK=false ;;
        /*) DOCKER_SOCK="$DOCKER_HOST" ;;
        *) DOCKER_SOCK_CHECK=false ;;
    esac
else
    DOCKER_SOCK="$HOME/.docker/run/docker.sock"
fi
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
while ( $DOCKER_SOCK_CHECK && [ ! -S "$DOCKER_SOCK" ] ) || ! "$DOCKER_CMD" info &>/dev/null; do
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

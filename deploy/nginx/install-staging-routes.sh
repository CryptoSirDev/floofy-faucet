#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG="/etc/nginx/sites-available/floofy-rpc"
BACKUP="${CONFIG}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
MARKER="# FLOOFY FAUCET V2 STAGING ROUTES"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash install-staging-routes.sh" >&2
  exit 1
fi
if [[ ! -f "$CONFIG" ]]; then
  echo "Nginx site config not found: $CONFIG" >&2
  exit 1
fi
if ! grep -q 'server_name rpc\.floofychain\.com www\.rpc\.floofychain\.com;' "$CONFIG"; then
  echo "Expected RPC server_name not found; refusing to modify config." >&2
  exit 1
fi
if grep -qF "$MARKER" "$CONFIG"; then
  echo "Staging routes already appear to be installed; no changes made."
  exit 0
fi
if [[ "$(grep -Fc '    location / {' "$CONFIG")" -ne 1 ]]; then
  echo "Expected exactly one 'location / {' insertion point; refusing to modify config." >&2
  exit 1
fi

cp -a "$CONFIG" "$BACKUP"

python3 - "$CONFIG" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = "    location / {"
if text.count(needle) != 1:
    raise SystemExit("Unexpected Nginx config layout; no edit made.")

block = """    # FLOOFY FAUCET V2 STAGING ROUTES
    # Authenticated endpoints proxy only to the private staging listener.
    location = /staging-v2/health {
        proxy_pass http://127.0.0.1:3002/health;
        proxy_set_header Host $host;
    }

    location = /staging-v2/internal/claim-reserve {
        limit_except POST { deny all; }
        proxy_pass http://127.0.0.1:3002/internal/claim-reserve;
        proxy_set_header X-API-Key $http_x_api_key;
        proxy_set_header Host $host;
        proxy_connect_timeout 3s;
        proxy_read_timeout 15s;
    }

    location = /staging-v2/internal/claim-consume {
        limit_except POST { deny all; }
        proxy_pass http://127.0.0.1:3002/internal/claim-consume;
        proxy_set_header X-API-Key $http_x_api_key;
        proxy_set_header Host $host;
        proxy_connect_timeout 3s;
        proxy_read_timeout 15s;
    }

    location = /staging-v2/internal/claim-status {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:3002/internal/claim-status$is_args$args;
        proxy_set_header X-API-Key $http_x_api_key;
        proxy_set_header Host $host;
        proxy_connect_timeout 3s;
        proxy_read_timeout 15s;
    }

"""
path.write_text(text.replace(needle, block + needle, 1))
PY

if ! nginx -t; then
  echo "Nginx validation failed; restoring backup." >&2
  cp -a "$BACKUP" "$CONFIG"
  nginx -t
  exit 1
fi

if ! systemctl reload nginx; then
  echo "Nginx reload failed; restoring backup." >&2
  cp -a "$BACKUP" "$CONFIG"
  nginx -t && systemctl reload nginx || true
  exit 1
fi

echo "Staging routes installed and Nginx reloaded."
echo "Backup: $BACKUP"
echo "Production routes were left unchanged."

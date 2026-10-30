#!/usr/bin/env bash
# The crawler VPS (Ops task): a fresh Ubuntu 24.04 server (Hetzner CX22 or a
# DigitalOcean droplet) ready to run the crawler and `npm run hello-capture`.
#
#   ssh root@<server> 'bash -s' < ops/vps-setup.sh
#
# Safe to run again. It creates the `sectionary` user, installs Node 24, git
# and Chromium with its system libraries (Playwright), clones the repo into
# /home/sectionary/sectionary, and creates the settings file OUTSIDE the repo:
#
#   /etc/sectionary/sectionary.env   owner sectionary, mode 600
#
# Fill that file in by hand over SSH (values from the password manager, never
# from chat or git), then, as the sectionary user:
#
#   cd ~/sectionary && npm run hello-capture
#
# It is loaded into every login shell of the sectionary user, so the crawler
# scripts see the same values.
set -euo pipefail

REPO="${REPO:-https://github.com/Benjovii/sectionary.git}"
BRANCH="${BRANCH:-main}"
APP_USER=sectionary
ENV_DIR=/etc/sectionary
ENV_FILE=$ENV_DIR/sectionary.env

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw unattended-upgrades

# Node 24 from NodeSource.
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Only SSH in. The crawler makes outgoing requests only.
ufw allow OpenSSH
ufw --force enable

id -u "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"

install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENV'
# Sectionary crawler settings. Outside the repo on purpose. Mode 600.
# Same names as .env.example in the repo.
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=
# DigitalOcean Spaces: region and public uploads.
S3_REGION=us-east-1
S3_ACL=public-read
SECTIONARY_BOT_URL=
ENV
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

PROFILE=/home/$APP_USER/.profile
grep -q "$ENV_FILE" "$PROFILE" 2>/dev/null || cat >> "$PROFILE" <<PROFILE

# Sectionary settings (ops/vps-setup.sh)
if [ -r $ENV_FILE ]; then set -a; . $ENV_FILE; set +a; fi
PROFILE

sudo -u "$APP_USER" -H bash <<USER
set -euo pipefail
cd ~
if [ -d sectionary/.git ]; then
  git -C sectionary fetch origin && git -C sectionary checkout "$BRANCH" && git -C sectionary pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO" sectionary
fi
cd sectionary
npm ci
USER

# Chromium's system libraries need root; the browser itself goes in the user's cache.
cd /home/$APP_USER/sectionary
npx --yes playwright install-deps chromium
sudo -u "$APP_USER" -H bash -c 'cd ~/sectionary && npx playwright install chromium'

echo
echo "Done. Next: fill in $ENV_FILE (sudo -u $APP_USER nano $ENV_FILE),"
echo "then: sudo -iu $APP_USER bash -c 'cd ~/sectionary && npm run hello-capture'"

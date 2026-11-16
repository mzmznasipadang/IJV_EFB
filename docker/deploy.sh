#!/usr/bin/env bash
set -euo pipefail
umask 022

revision=${1:-}
if [[ $# != 1 || ! $revision =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: deploy-ijv-efb <commit SHA>" >&2
  exit 2
fi

app=/opt/ijv-efb
repo=/srv/gitea/data/git/repositories/mzmznasipadang/ijvefb.git
mkdir -p "$app/releases"
exec 9>"$app/.deploy.lock"
flock 9

repository() {
  git -c safe.directory="$repo" --git-dir="$repo" "$@"
}

compose() {
  local release=$1 tag=$2
  shift 2
  EFB_IMAGE_TAG="$tag" docker compose --project-name ijv-efb \
    --env-file "$app/.env" --project-directory "$release" -f "$release/compose.yaml" "$@"
}

if [[ $(repository rev-parse refs/heads/main) != "$revision" ]]; then
  echo "Skipping $revision because main has advanced."
  exit 0
fi

previous=$(readlink -f "$app/current" || true)
previous_tag=latest
if [[ -f "$previous/compose.yaml" ]]; then
  previous_tag=${previous##*/}
else
  previous=$app
fi

release="$app/releases/$revision"
mkdir -p "$release"
repository archive "$revision" | tar -xf - -C "$release"
compose "$release" "$revision" build

if [[ $(repository rev-parse refs/heads/main) != "$revision" ]]; then
  echo "Skipping activation of $revision because main has advanced."
  exit 0
fi

if ! compose "$release" "$revision" up -d --no-build --wait --wait-timeout 120; then
  echo "Deployment failed health checks. Restoring $previous_tag." >&2
  compose "$previous" "$previous_tag" up -d --no-build --wait --wait-timeout 120
  exit 1
fi

ln -sfn "$release" "$app/current.next"
mv -Tf "$app/current.next" "$app/current"
echo "Deployed $revision to ijv-efb."

#!/usr/bin/env bash
set -euo pipefail

BASE="http://127.0.0.1:8000"
SUFFIX=$RANDOM
EMAIL="test${SUFFIX}@example.com"
PASSWORD="Password123"
USERNAME="test${SUFFIX}"

command -v jq >/dev/null 2>&1 || { echo "jq gerekli: sudo pacman -S jq" >&2; exit 1; }

health=$(curl -fsS "$BASE/health")

registered=$(curl -fsS -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg u "$USERNAME" --arg e "$EMAIL" --arg p "$PASSWORD" \
        '{username:$u, email:$e, password:$p}')")

login=$(curl -fsS -X POST "$BASE/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e, password:$p}')")

token=$(echo "$login" | jq -r '.access_token')

me=$(curl -fsS "$BASE/api/v1/auth/me" -H "Authorization: Bearer $token")

project=$(curl -fsS -X POST "$BASE/api/v1/projects/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  -d "$(jq -n --arg n "Local Smoke Project" '{name:$n}')")

jq -n \
  --arg health        "$(echo "$health"     | jq -r '.status')" \
  --arg registered    "$(echo "$registered" | jq -r '.email')" \
  --arg currentUser   "$(echo "$me"          | jq -r '.username')" \
  --arg project       "$(echo "$project"    | jq -r '.name')" \
  --arg projectStatus "$(echo "$project"    | jq -r '.status')" \
  '{health:$health, registered:$registered, currentUser:$currentUser, project:$project, projectStatus:$projectStatus}'
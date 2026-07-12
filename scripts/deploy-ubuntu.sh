#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

REPO_URL="${REPO_URL:-https://github.com/PuneetGOTO/AI-Agent-Help.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-}"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-900}"
MIN_FREE_GB="${MIN_FREE_GB:-15}"
MIN_SYSTEM_FREE_GB="${MIN_SYSTEM_FREE_GB:-2}"
STATE_DIR="${STATE_DIR:-/var/lib/ai-agent-platform}"
SKIP_DOCKER_INSTALL=false
SKIP_SEED=false
COMPOSE_READY=false
APP_DIR=""
CREATED_ENV=false
DEPLOY_URL=""
HOST_API_PORT=4000
HOST_WEB_PORT=3000
HOST_POSTGRES_PORT=5432
HOST_REDIS_PORT=6379
HOST_MINIO_API_PORT=9000
HOST_MINIO_CONSOLE_PORT=9001
TEMP_FILES=()

log() {
  printf '[agent-platform] %s\n' "$*"
}

fail() {
  printf '[agent-platform] ERROR: %s\n' "$*" >&2
  exit 1
}

validate_safe_email() {
  local value="$1" name="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9.!_%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
    fail "$name must be a dotenv-safe email address"
  fi
}

cleanup_temp_files() {
  if ((${#TEMP_FILES[@]})); then
    rm -f -- "${TEMP_FILES[@]}"
  fi
}
trap cleanup_temp_files EXIT

usage() {
  cat <<'EOF'
Usage: deploy-ubuntu.sh [options]

This installer must run as root. Use sudo when invoking it from a normal account.

Options:
  --domain DOMAIN       Enable public HTTPS through Caddy. DNS must already
                        point to this server and ports 80/443 must be open.
  --admin-email EMAIL   Initial Owner email (default: admin@example.com).
  --acme-email EMAIL    ACME account email (defaults to the admin email).
  --install-dir PATH    Deployment checkout (default: current repository or
                        /opt/ai-agent-help when downloaded as a standalone file).
  --skip-docker-install Require an existing Docker Engine and Compose plugin.
  --skip-seed           Do not create the initial Owner/organization/workspace.
  -h, --help            Show this help.

Environment overrides:
  ADMIN_PASSWORD        Initial Owner password. When omitted, a strong password
                        is generated and stored in the root-only credentials file.
  DEPLOY_TIMEOUT        Health-check timeout in seconds (default: 900).
  MIN_FREE_GB           Required free space for the Docker data root (default: 15).
  MIN_SYSTEM_FREE_GB    Required free space for Ubuntu packages (default: 2).
  REPO_URL              Git repository used by standalone execution.
  REPO_BRANCH           Git branch used by standalone execution (default: main).

Examples:
  sudo bash scripts/deploy-ubuntu.sh
  sudo bash scripts/deploy-ubuntu.sh --domain agents.example.com \
    --admin-email owner@example.com --acme-email ops@example.com
EOF
}

while (($#)); do
  case "$1" in
    --domain)
      [[ $# -ge 2 ]] || fail '--domain requires a value'
      DEPLOY_DOMAIN="$2"
      shift 2
      ;;
    --admin-email)
      [[ $# -ge 2 ]] || fail '--admin-email requires a value'
      ADMIN_EMAIL="$2"
      shift 2
      ;;
    --acme-email)
      [[ $# -ge 2 ]] || fail '--acme-email requires a value'
      ACME_EMAIL="$2"
      shift 2
      ;;
    --install-dir)
      [[ $# -ge 2 ]] || fail '--install-dir requires a value'
      INSTALL_DIR="$2"
      shift 2
      ;;
    --skip-docker-install)
      SKIP_DOCKER_INSTALL=true
      shift
      ;;
    --skip-seed)
      SKIP_SEED=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

if [[ ! "$DEPLOY_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  fail 'DEPLOY_TIMEOUT must be a positive integer'
fi
if [[ ! "$MIN_FREE_GB" =~ ^[1-9][0-9]*$ ]]; then
  fail 'MIN_FREE_GB must be a positive integer'
fi
if [[ ! "$MIN_SYSTEM_FREE_GB" =~ ^[1-9][0-9]*$ ]]; then
  fail 'MIN_SYSTEM_FREE_GB must be a positive integer'
fi
validate_safe_email "$ADMIN_EMAIL" 'ADMIN_EMAIL'
if [[ -n "$ACME_EMAIL" ]]; then
  validate_safe_email "$ACME_EMAIL" 'ACME_EMAIL'
fi
if [[ -n "$DEPLOY_DOMAIN" ]]; then
  DEPLOY_DOMAIN="${DEPLOY_DOMAIN,,}"
  DEPLOY_DOMAIN="${DEPLOY_DOMAIN%.}"
  if [[ ! "$DEPLOY_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    fail 'DEPLOY_DOMAIN must be a DNS hostname, not a URL or IP address'
  fi
fi

if [[ ! -r /etc/os-release ]]; then
  fail 'unable to identify the operating system'
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != 'ubuntu' ]]; then
  fail "this installer supports Ubuntu only (detected: ${ID:-unknown})"
fi

if [[ $EUID -ne 0 ]]; then
  fail 'run this installer as root (for example: sudo bash scripts/deploy-ubuntu.sh)'
fi
ROOT=()

run_root() {
  "${ROOT[@]}" "$@"
}

on_error() {
  local line="$1"
  local log_services=(migrate api web)
  printf '[agent-platform] Deployment failed near line %s.\n' "$line" >&2
  if [[ "$COMPOSE_READY" == true && -n "$APP_DIR" ]]; then
    if [[ -n "$DEPLOY_DOMAIN" ]]; then
      log_services+=(caddy)
    fi
    (
      cd "$APP_DIR"
      compose ps --all || true
      compose logs --tail=120 "${log_services[@]}" 2>/dev/null || true
    ) >&2
  fi
}
trap 'on_error "$LINENO"' ERR

install_base_packages() {
  log 'Installing required Ubuntu packages...'
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl git gnupg iproute2 openssl
}

check_conflicting_docker_packages() {
  local package status
  local conflicts=()
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    status="$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)"
    if [[ "$status" == 'installed' ]]; then
      conflicts+=("$package")
    fi
  done
  if ((${#conflicts[@]})); then
    fail "conflicting Docker packages are installed: ${conflicts[*]}. Review workloads and remove or migrate them explicitly before installing docker-ce"
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log 'Docker Engine and Compose plugin are already available.'
    run_root systemctl enable --now docker
    return
  fi
  if [[ "$SKIP_DOCKER_INSTALL" == true ]]; then
    fail 'Docker Engine with the Compose plugin is required'
  fi

  check_conflicting_docker_packages
  log 'Installing Docker Engine from the official Ubuntu repository...'
  local key_file repo_file architecture codename
  key_file="$(mktemp)"
  repo_file="$(mktemp)"
  TEMP_FILES+=("$key_file" "$repo_file")
  architecture="$(dpkg --print-architecture)"
  codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$codename" ]] || fail 'unable to determine the Ubuntu codename'

  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$key_file"
  printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
    "$codename" "$architecture" >"$repo_file"
  run_root install -m 0755 -d /etc/apt/keyrings
  run_root install -m 0644 "$key_file" /etc/apt/keyrings/docker.asc
  run_root install -m 0644 "$repo_file" /etc/apt/sources.list.d/docker.sources
  rm -f "$key_file" "$repo_file"

  run_root env DEBIAN_FRONTEND=noninteractive apt-get update
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  run_root systemctl enable --now docker
}

select_docker_command() {
  if docker info >/dev/null 2>&1; then
    DOCKER=(docker)
  elif run_root docker info >/dev/null 2>&1; then
    DOCKER=("${ROOT[@]}" docker)
  else
    fail 'Docker daemon is not available after installation'
  fi
}

compose() {
  "${COMPOSE[@]}" "$@"
}

detect_source_checkout() {
  local source_path source_root
  source_path="${BASH_SOURCE[0]:-}"
  if [[ -n "$source_path" && -f "$source_path" ]]; then
    source_root="$(cd "$(dirname "$source_path")/.." && pwd -P)"
    if [[ -f "$source_root/docker-compose.yml" ]]; then
      printf '%s\n' "$source_root"
      return
    fi
  fi
  printf '\n'
}

prepare_checkout() {
  local source_checkout target_parent
  source_checkout="$(detect_source_checkout)"
  if [[ -z "$INSTALL_DIR" ]]; then
    if [[ -n "$source_checkout" ]]; then
      APP_DIR="$source_checkout"
    else
      APP_DIR='/opt/ai-agent-help'
    fi
  else
    APP_DIR="$INSTALL_DIR"
  fi

  if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
    log "Using existing checkout at $APP_DIR"
    return
  fi
  if [[ -e "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    fail "$APP_DIR exists but is not an Agent Platform checkout"
  fi

  target_parent="$(dirname "$APP_DIR")"
  run_root install -m 0755 -d "$target_parent"
  log "Cloning $REPO_URL ($REPO_BRANCH) into $APP_DIR..."
  run_root git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
}

env_value() {
  local key="$1" file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

require_env_value() {
  local key="$1" file="$2"
  if ! grep -Eq "^${key}=.+$" "$file"; then
    fail "$file is missing a non-empty $key"
  fi
}

random_hex() {
  openssl rand -hex "$1"
}

validate_admin_password() {
  local value="$1"
  if [[ ! "$value" =~ ^[A-Za-z0-9_.!@%+=:-]{12,72}$ ]] ||
    [[ ! "$value" =~ [A-Z] ]] ||
    [[ ! "$value" =~ [a-z] ]] ||
    [[ ! "$value" =~ [0-9] ]] ||
    [[ ! "$value" =~ [^A-Za-z0-9] ]]; then
    fail 'ADMIN_PASSWORD must be 12-72 safe ASCII characters with upper, lower, number, and symbol'
  fi
}

validate_host_port() {
  local value="$1" name="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]{0,4}$ ]] || ((value > 65535)); then
    fail "$name must be a valid TCP/UDP port"
  fi
}

load_host_port() {
  local variable="$1" key="$2" fallback="$3" file="$4" value
  value="$(env_value "$key" "$file")"
  value="${value:-$fallback}"
  validate_host_port "$value" "$key in .env"
  printf -v "$variable" '%s' "$value"
}

write_new_environment() {
  local env_file temp_file postgres_password s3_access_key s3_secret_key
  local jwt_access_secret jwt_refresh_secret encryption_key generated_admin_password
  env_file="$APP_DIR/.env"
  temp_file="$(mktemp)"
  TEMP_FILES+=("$temp_file")
  postgres_password="$(random_hex 24)"
  s3_access_key="ap$(random_hex 12)"
  s3_secret_key="$(random_hex 32)"
  jwt_access_secret="$(random_hex 48)"
  jwt_refresh_secret="$(random_hex 48)"
  encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
  generated_admin_password="${ADMIN_PASSWORD:-Aa1!$(random_hex 18)}"

  validate_admin_password "$generated_admin_password"

  if [[ -n "$DEPLOY_DOMAIN" ]]; then
    DEPLOY_URL="https://$DEPLOY_DOMAIN"
    COOKIE_SECURE='true'
    ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"
  else
    DEPLOY_URL='http://localhost:3000'
    COOKIE_SECURE='false'
    ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"
  fi

  cat >"$temp_file" <<EOF
NODE_ENV=production
IMAGE_TAG=local
WEB_PORT=3000
API_PORT=4000
TRUST_PROXY_HOPS=1
WEB_BIND_ADDRESS=127.0.0.1
API_BIND_ADDRESS=127.0.0.1
POSTGRES_PORT=5432
REDIS_PORT=6379
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
POSTGRES_BIND_ADDRESS=127.0.0.1
REDIS_BIND_ADDRESS=127.0.0.1
MINIO_BIND_ADDRESS=127.0.0.1
WEB_URL=$DEPLOY_URL
API_URL=http://localhost:4000
API_PROXY_URL=http://api:4000
NEXT_PUBLIC_API_URL=$DEPLOY_URL/api/v1
DEPLOY_DOMAIN=$DEPLOY_DOMAIN
ACME_EMAIL=$ACME_EMAIL

POSTGRES_DB=agent_platform
POSTGRES_USER=agent_platform
POSTGRES_PASSWORD=$postgres_password
DATABASE_URL=postgresql://agent_platform:$postgres_password@localhost:5432/agent_platform?schema=public

REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ALLOW_INSECURE_INTERNAL_ENDPOINT=true
S3_REGION=us-east-1
S3_BUCKET=agent-platform
S3_ACCESS_KEY=$s3_access_key
S3_SECRET_KEY=$s3_secret_key
S3_FORCE_PATH_STYLE=true

JWT_ACCESS_SECRET=$jwt_access_secret
JWT_REFRESH_SECRET=$jwt_refresh_secret
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
ENCRYPTION_KEY=$encryption_key
COOKIE_SECURE=$COOKIE_SECURE
BOOTSTRAP_TOKEN=
OLLAMA_ALLOWED_BASE_URLS=
BEDROCK_ALLOWED_ENDPOINTS=

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$generated_admin_password
ADMIN_NAME=Platform Administrator
DEFAULT_ORGANIZATION_NAME=Acme Corporation
DEFAULT_WORKSPACE_NAME=AI Operations

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-4.1-mini
EOF

  run_root install -m 0600 "$temp_file" "$env_file"
  rm -f "$temp_file"
  ADMIN_PASSWORD="$generated_admin_password"
  CREATED_ENV=true
  write_credentials_file
  log "Created a protected environment file at $env_file"
}

write_credentials_file() {
  local temp_file credentials_file
  temp_file="$(mktemp)"
  TEMP_FILES+=("$temp_file")
  credentials_file="$STATE_DIR/admin-credentials"
  cat >"$temp_file" <<EOF
DEPLOY_URL=$DEPLOY_URL
APP_DIR=$APP_DIR
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
  run_root install -m 0700 -d "$STATE_DIR"
  run_root install -m 0600 "$temp_file" "$credentials_file"
  rm -f "$temp_file"
}

secure_environment_file() {
  local env_file="$APP_DIR/.env"
  run_root chown root:root "$env_file"
  run_root chmod 0600 "$env_file"
  log "Secured $env_file as root:root with mode 0600."
}

load_or_create_environment() {
  local env_file existing_domain
  env_file="$APP_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    write_new_environment
    return
  fi

  secure_environment_file
  log "Preserving existing environment file at $env_file"
  for key in POSTGRES_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY ADMIN_EMAIL; do
    require_env_value "$key" "$env_file"
  done

  existing_domain="$(env_value DEPLOY_DOMAIN "$env_file")"
  if [[ -n "$DEPLOY_DOMAIN" && "$DEPLOY_DOMAIN" != "$existing_domain" ]]; then
    fail "--domain does not match DEPLOY_DOMAIN in the existing .env"
  fi
  DEPLOY_DOMAIN="${existing_domain:-$DEPLOY_DOMAIN}"
  ADMIN_EMAIL="$(env_value ADMIN_EMAIL "$env_file")"
  ADMIN_PASSWORD="$(env_value ADMIN_PASSWORD "$env_file")"
  ACME_EMAIL="$(env_value ACME_EMAIL "$env_file")"
  validate_safe_email "$ADMIN_EMAIL" 'ADMIN_EMAIL in .env'
  if [[ -n "$DEPLOY_DOMAIN" ]]; then
    if [[ ! "$DEPLOY_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
      fail 'DEPLOY_DOMAIN in .env must be a lowercase DNS hostname'
    fi
    require_env_value ACME_EMAIL "$env_file"
    validate_safe_email "$ACME_EMAIL" 'ACME_EMAIL in .env'
    DEPLOY_URL="https://$DEPLOY_DOMAIN"
  else
    DEPLOY_URL="$(env_value WEB_URL "$env_file")"
    DEPLOY_URL="${DEPLOY_URL:-http://localhost:3000}"
  fi
  load_host_port HOST_API_PORT API_PORT 4000 "$env_file"
  load_host_port HOST_WEB_PORT WEB_PORT 3000 "$env_file"
  load_host_port HOST_POSTGRES_PORT POSTGRES_PORT 5432 "$env_file"
  load_host_port HOST_REDIS_PORT REDIS_PORT 6379 "$env_file"
  load_host_port HOST_MINIO_API_PORT MINIO_API_PORT 9000 "$env_file"
  load_host_port HOST_MINIO_CONSOLE_PORT MINIO_CONSOLE_PORT 9001 "$env_file"
  if [[ "$SKIP_SEED" == false ]]; then
    require_env_value ADMIN_PASSWORD "$env_file"
    validate_admin_password "$ADMIN_PASSWORD"
  fi
}

check_free_space() {
  local path="$1" minimum_gb="$2" available_kb required_kb
  [[ -e "$path" ]] || path="$(dirname "$path")"
  available_kb="$(df -Pk "$path" | awk 'NR==2 {print $4}')"
  required_kb=$((minimum_gb * 1024 * 1024))
  if [[ ! "$available_kb" =~ ^[0-9]+$ ]] || ((available_kb < required_kb)); then
    fail "at least ${minimum_gb} GiB free space is required on the filesystem containing $path"
  fi
  log "Disk preflight passed for $path ($((available_kb / 1024 / 1024)) GiB free)."
}

wait_for_url() {
  local name="$1" url="$2" deadline
  deadline=$((SECONDS + DEPLOY_TIMEOUT))
  log "Waiting for $name at $url..."
  until curl -fsS --max-time 10 "$url" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      fail "$name did not become ready within ${DEPLOY_TIMEOUT}s"
    fi
    sleep 5
  done
}

configure_compose() {
  COMPOSE=("${DOCKER[@]}" compose --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml")
  if [[ -n "$DEPLOY_DOMAIN" ]]; then
    COMPOSE+=(-f "$APP_DIR/deploy/ubuntu/docker-compose.https.yml")
  fi
  COMPOSE_READY=true
}

host_port_in_use() {
  local protocol="$1" port="$2" sockets
  if [[ "$protocol" == 'tcp' ]]; then
    sockets="$(ss -H -ltn 2>/dev/null || true)"
  else
    sockets="$(ss -H -lun 2>/dev/null || true)"
  fi
  awk '{print $4}' <<<"$sockets" | grep -Eq ":${port}$"
}

require_free_host_port() {
  local protocol="$1" port="$2" label="$3"
  if host_port_in_use "$protocol" "$port"; then
    fail "$label requires free $protocol port $port, but another process is already listening"
  fi
}

check_host_ports() {
  if compose ps -q 2>/dev/null | grep -q .; then
    log 'Existing Compose containers detected; preserving their bound ports for this rerun.'
    return
  fi

  require_free_host_port tcp "$HOST_WEB_PORT" 'Web'
  require_free_host_port tcp "$HOST_API_PORT" 'API'
  require_free_host_port tcp "$HOST_POSTGRES_PORT" 'PostgreSQL'
  require_free_host_port tcp "$HOST_REDIS_PORT" 'Redis'
  require_free_host_port tcp "$HOST_MINIO_API_PORT" 'MinIO API'
  require_free_host_port tcp "$HOST_MINIO_CONSOLE_PORT" 'MinIO Console'
  if [[ -n "$DEPLOY_DOMAIN" ]]; then
    require_free_host_port tcp 80 'Caddy HTTP'
    require_free_host_port tcp 443 'Caddy HTTPS'
    require_free_host_port udp 443 'Caddy HTTP/3'
  fi
  log 'Host port preflight passed.'
}

deploy_stack() {
  cd "$APP_DIR"
  compose config --quiet
  log 'Building images and starting services...'
  compose up -d --build

  if [[ "$SKIP_SEED" == false ]]; then
    log 'Creating or verifying the initial Owner, organization, and workspace...'
    compose --profile seed run --rm seed
  fi

  wait_for_url 'API health endpoint' "http://127.0.0.1:$HOST_API_PORT/api/v1/health"
  wait_for_url 'Web login page' "http://127.0.0.1:$HOST_WEB_PORT/login"
  if [[ -n "$DEPLOY_DOMAIN" ]]; then
    wait_for_url 'public HTTPS endpoint' "$DEPLOY_URL/login"
  fi

  compose ps
}

show_result() {
  printf '\nDeployment completed.\n'
  printf 'Application: %s\n' "$DEPLOY_URL"
  printf 'Checkout:    %s\n' "$APP_DIR"
  if [[ "$CREATED_ENV" == true ]]; then
    printf 'Credentials: sudo cat %s/admin-credentials\n' "$STATE_DIR"
  fi
  if [[ "$SKIP_SEED" == true ]]; then
    printf 'Initial Owner: not created because --skip-seed was used\n'
  fi
  if [[ -z "$DEPLOY_DOMAIN" ]]; then
    printf '\nThe local-only profile binds all services to 127.0.0.1.\n'
    printf 'From your workstation, open an SSH tunnel first:\n'
    printf '  ssh -L %s:127.0.0.1:%s USER@SERVER\n' "$HOST_WEB_PORT" "$HOST_WEB_PORT"
    printf 'Then browse to http://localhost:%s.\n' "$HOST_WEB_PORT"
  else
    printf '\nHTTPS is managed by Caddy. Keep DNS pointed at this server and ports 80/443 open.\n'
  fi
  printf '\nUseful commands:\n'
  printf '  cd %s\n' "$APP_DIR"
  if [[ -n "$DEPLOY_DOMAIN" ]]; then
    printf '  sudo docker compose --env-file .env -f docker-compose.yml -f deploy/ubuntu/docker-compose.https.yml ps\n'
    printf '  sudo docker compose --env-file .env -f docker-compose.yml -f deploy/ubuntu/docker-compose.https.yml logs --tail=100 api web caddy\n'
  else
    printf '  sudo docker compose --env-file .env -f docker-compose.yml ps\n'
    printf '  sudo docker compose --env-file .env -f docker-compose.yml logs --tail=100 api web\n'
  fi
}

check_free_space / "$MIN_SYSTEM_FREE_GB"
install_base_packages
install_docker
select_docker_command
prepare_checkout
load_or_create_environment

docker_root="$("${DOCKER[@]}" info --format '{{.DockerRootDir}}')"
if [[ -z "$docker_root" || "$docker_root" != /* ]]; then
  fail 'Docker returned an invalid data root path'
fi
check_free_space "$docker_root" "$MIN_FREE_GB"

configure_compose
check_host_ports
deploy_stack
show_result

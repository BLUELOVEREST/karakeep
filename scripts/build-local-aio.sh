#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-karakeep-aio}"
IMAGE_TAG="${IMAGE_TAG:-local-eric}"
SERVER_VERSION="${SERVER_VERSION:-local-eric}"
PLATFORM="${PLATFORM:-linux/amd64}"
LOCAL_BUILD_MODE="${LOCAL_BUILD_MODE:-reuse-runtime}"
RUNTIME_BASE_IMAGE="${RUNTIME_BASE_IMAGE:-ghcr.io/blueloverest/karakeep-aio:0.32.0-eric.5}"
APT_MIRROR="${APT_MIRROR:-http://mirrors.tuna.tsinghua.edu.cn/debian}"
APT_SECURITY_MIRROR="${APT_SECURITY_MIRROR:-http://mirrors.tuna.tsinghua.edu.cn/debian-security}"
NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"

echo "Building ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Platform: ${PLATFORM}"
echo "Mode: ${LOCAL_BUILD_MODE}"
echo "APT mirror: ${APT_MIRROR}"
echo "NPM registry: ${NPM_CONFIG_REGISTRY}"
echo "Corepack registry: ${NPM_CONFIG_REGISTRY}"

build_reuse_runtime() {
  if ! docker image inspect "${RUNTIME_BASE_IMAGE}" >/dev/null 2>&1; then
    echo "Runtime base image is missing locally: ${RUNTIME_BASE_IMAGE}" >&2
    echo "Pull it first, or set RUNTIME_BASE_IMAGE to an existing local AIO image." >&2
    exit 1
  fi

  docker buildx build \
    --load \
    --platform "${PLATFORM}" \
    --file "${ROOT_DIR}/docker/Dockerfile" \
    --target local_aio \
    --build-arg "SERVER_VERSION=${SERVER_VERSION}" \
    --build-arg "APT_MIRROR=${APT_MIRROR}" \
    --build-arg "APT_SECURITY_MIRROR=${APT_SECURITY_MIRROR}" \
    --build-arg "NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}" \
    --build-arg "RUNTIME_BASE_IMAGE=${RUNTIME_BASE_IMAGE}" \
    --tag "${IMAGE_NAME}:${IMAGE_TAG}" \
    "${ROOT_DIR}"
}

build_full() {
  docker buildx build \
    --load \
    --platform "${PLATFORM}" \
    --file "${ROOT_DIR}/docker/Dockerfile" \
    --target aio \
    --build-arg "SERVER_VERSION=${SERVER_VERSION}" \
    --build-arg "APT_MIRROR=${APT_MIRROR}" \
    --build-arg "APT_SECURITY_MIRROR=${APT_SECURITY_MIRROR}" \
    --build-arg "NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}" \
    --tag "${IMAGE_NAME}:${IMAGE_TAG}" \
    "${ROOT_DIR}"
}

case "${LOCAL_BUILD_MODE}" in
  reuse-runtime)
    echo "Runtime base: ${RUNTIME_BASE_IMAGE}"
    build_reuse_runtime
    ;;
  full)
    build_full
    ;;
  *)
    echo "Unsupported LOCAL_BUILD_MODE: ${LOCAL_BUILD_MODE}" >&2
    echo "Supported modes: reuse-runtime, full" >&2
    exit 1
    ;;
esac

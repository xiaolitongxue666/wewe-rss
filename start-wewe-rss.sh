#!/usr/bin/env bash
# 在 Git Bash 下于项目根目录启动 WeWe-RSS（Docker + SQLite 数据卷 ./data）
# 数据位于当前仓库的 data/，将仓库放在非 C 盘可减轻系统盘占用。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Windows Git Bash 下部分环境仅注册 `docker-compose` 可执行文件，`docker compose` 会退化为非法参数
if command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  DOCKER_COMPOSE=(docker compose)
fi

# 可选：仅为宿主机上的 docker pull 等命令走代理（容器内代理请用 compose.env 或 docker-compose.override.yml）
if [[ "${USE_HOST_PROXY:-}" == "1" ]]; then
  export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
  export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
fi

mkdir -p data

ENV_FILE_ARGS=()
if [[ -f compose.env ]]; then
  ENV_FILE_ARGS+=(--env-file compose.env)
fi

COMPOSE_FILES=(-f docker-compose.sqlite.yml)
if [[ -f docker-compose.override.yml ]]; then
  COMPOSE_FILES+=(-f docker-compose.override.yml)
fi

"${DOCKER_COMPOSE[@]}" "${ENV_FILE_ARGS[@]}" "${COMPOSE_FILES[@]}" up -d

echo "Waiting for http://localhost:4000 ..."
READY=
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null -m 2 "http://localhost:4000"; then
    READY=1
    break
  fi
  sleep 1
done

if [[ -n "${READY:-}" ]]; then
  echo "OK: service responds on http://localhost:4000"
else
  echo "Warning: port 4000 did not respond in time. Check: ${DOCKER_COMPOSE[*]} logs app" >&2
  exit 1
fi

"${DOCKER_COMPOSE[@]}" "${ENV_FILE_ARGS[@]}" "${COMPOSE_FILES[@]}" ps

echo ""
echo "=== 下一步：在 Cursor 内置浏览器打开管理页 ==="
echo "地址: http://localhost:4000"
echo ""
echo "  方式一：在本对话中让 AI 使用 Browser（Browser MCP）打开上述地址。"
echo "  方式二：Ctrl+Shift+P 打开命令面板，搜索「Simple Browser」或「简易浏览器」，"
echo "          选择 Show，再粘贴 http://localhost:4000"
echo ""
echo "  手机：在「账号管理」里扫微信读书二维码；在「公众号源」里粘贴 mp.weixin.qq.com/s/… 链接添加订阅。"
echo ""

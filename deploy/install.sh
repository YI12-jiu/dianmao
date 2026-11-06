#!/usr/bin/env bash
# 点卯 · 服务器一键部署（Ubuntu / Debian / CentOS / Alibaba Cloud Linux）
#
#   sudo bash deploy/install.sh                       # 部署到 /dianmao/ 并起同步服务
#   sudo bash deploy/install.sh --prefix /kaoqin      # 换一个访问路径
#   sudo bash deploy/install.sh --static-only         # 只放静态站，不起同步服务
#   sudo bash deploy/install.sh --token 你的口令       # 给同步接口加 Bearer 校验
#
# 做的事：静态文件 → /var/www/dianmao，同步服务 → /opt/dianmao，写 nginx 配置并 reload。
# 不会动你现有的站点：新站挂在 /dianmao/ 子路径下，原有 app.html 不受影响。

set -euo pipefail

PREFIX="/dianmao"
STATIC_ONLY=0
TOKEN=""
SYNC_PORT=8788
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --port) SYNC_PORT="$2"; shift 2 ;;
    --static-only) STATIC_ONLY=1; shift ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

PREFIX="/${PREFIX#/}"; PREFIX="${PREFIX%/}"
WEB_PARENT=/var/www
WEB_DIR="${WEB_PARENT}${PREFIX}"
APP_DIR=/opt/dianmao
DATA_DIR="${APP_DIR}/data"

say() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1"; }

[[ $EUID -eq 0 ]] || { echo "请用 sudo 运行"; exit 1; }
[[ -f "${SRC}/index.html" ]] || { echo "找不到 index.html，请在项目目录内运行"; exit 1; }

# ---------- 1. 静态文件 ----------
say "部署静态站到 ${WEB_DIR}"
mkdir -p "${WEB_DIR}/assets/css" "${WEB_DIR}/assets/js"
cp "${SRC}/index.html" "${SRC}/teacher.html" "${SRC}/student.html" \
   "${SRC}/sw.js" "${SRC}/manifest.webmanifest" "${WEB_DIR}/"
cp "${SRC}/assets/css/"*.css "${WEB_DIR}/assets/css/"
cp "${SRC}/assets/js/"*.js "${WEB_DIR}/assets/js/"
cp "${SRC}/assets/icon.svg" "${SRC}/assets/icon-maskable.svg" "${WEB_DIR}/assets/"
chown -R www-data:www-data "${WEB_PARENT}" 2>/dev/null || chown -R nginx:nginx "${WEB_PARENT}" 2>/dev/null || true

# ---------- 2. 同步服务 ----------
if [[ ${STATIC_ONLY} -eq 0 ]]; then
  if ! command -v node >/dev/null 2>&1; then
    warn "服务器上没有 node，跳过同步服务。装好 Node 18+ 后再跑一次本脚本。"
    warn "  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs"
    STATIC_ONLY=1
  fi
fi

if [[ ${STATIC_ONLY} -eq 0 ]]; then
  say "安装同步服务到 ${APP_DIR}"
  mkdir -p "${APP_DIR}/server" "${DATA_DIR}"
  cp "${SRC}/sync-service/server.js" "${APP_DIR}/server/"
  id -u www-data >/dev/null 2>&1 && RUN_USER=www-data || RUN_USER=nobody
  chown -R "${RUN_USER}:${RUN_USER}" "${APP_DIR}"

  if [[ -z "${TOKEN}" ]]; then
    TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    warn "未指定 --token，已生成随机令牌：${TOKEN}"
    warn "把它填到老师端「设置 → 访问令牌」，否则接口是裸开的（只监听本机仍可用）。"
  fi

  NODE_BIN="$(command -v node)"
  cat > /etc/systemd/system/dianmao-sync.service <<EOF
[Unit]
Description=Dianmao attendance sync
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${APP_DIR}/server
Environment=HOST=127.0.0.1
Environment=PORT=${SYNC_PORT}
Environment=DATA_DIR=${DATA_DIR}
Environment=TOKEN=${TOKEN}
ExecStart=${NODE_BIN} ${APP_DIR}/server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now dianmao-sync >/dev/null
  sleep 1
  if curl -fsS "http://127.0.0.1:${SYNC_PORT}/health" >/dev/null 2>&1; then
    say "同步服务已启动：127.0.0.1:${SYNC_PORT}"
  else
    warn "服务未响应，用 journalctl -u dianmao-sync -n 30 看原因"
  fi

  # 前端接口地址指向同源反代路径
  sed -i "s|endpoint: ''|endpoint: '${PREFIX}/api'|" "${WEB_DIR}/assets/js/config.js" || true
fi

# ---------- 3. nginx ----------
say "写入 nginx 配置"
CONF_DIR=/etc/nginx/conf.d
[[ -d /etc/nginx/sites-available ]] && CONF_DIR=/etc/nginx/sites-available
cat > "${CONF_DIR}/dianmao.conf" <<EOF
# 点卯 · 课堂考勤工作台（挂在 ${PREFIX}/ 下，不影响已有站点）

location = ${PREFIX} { return 301 ${PREFIX}/; }

# Service Worker 不缓存，避免更新后拿到旧壳
location = ${PREFIX}/sw.js {
    root ${WEB_PARENT};
    add_header Cache-Control "no-cache, must-revalidate";
}

# 静态资源长缓存
location ~ ^${PREFIX}/.*\.(css|js|svg|webmanifest)\$ {
    root ${WEB_PARENT};
    add_header Cache-Control "public, max-age=604800";
}

location ${PREFIX}/ {
    root ${WEB_PARENT};
    index index.html;
    try_files \$uri \$uri/ ${PREFIX}/index.html;
}

location ${PREFIX}/api/ {
    proxy_pass http://127.0.0.1:${SYNC_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_read_timeout 30s;
    client_max_body_size 4m;
}
EOF
[[ -d /etc/nginx/sites-enabled ]] && ln -sf "${CONF_DIR}/dianmao.conf" /etc/nginx/sites-enabled/dianmao.conf

if nginx -t 2>/dev/null; then
  systemctl reload nginx || nginx -s reload
  say "nginx 已重载"
else
  warn "nginx 配置自检未通过，请手动检查 ${CONF_DIR}/dianmao.conf"
  nginx -t || true
fi

HOST_IP="$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || echo '你的域名')"
cat <<EOF

========================================
  部署完成
  访问： http://${HOST_IP}${PREFIX}/
  老师： t1001 / 123456
  学生： 2026001 / 123456
  班级码：880123

  同步服务： systemctl status dianmao-sync
  数据目录： ${DATA_DIR}
  令牌：     ${TOKEN:-（未启用）}

  要真正离线可用（Service Worker）需上 HTTPS：
  用 certbot --nginx -d 你的域名 签一张证书即可。
========================================
EOF

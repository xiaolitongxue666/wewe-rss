<div align="center">
<img src="https://raw.githubusercontent.com/cooderl/wewe-rss/main/assets/logo.png" width="80" alt="预览"/>

# [WeWe RSS](https://github.com/cooderl/wewe-rss)

更优雅的微信公众号订阅方式。

![主界面](https://raw.githubusercontent.com/cooderl/wewe-rss/main/assets/preview1.png)
</div>

## ✨ 功能

- v2.x版本使用全新接口，更加稳定
- 支持微信公众号订阅（基于微信读书）
- 获取公众号历史发布文章
- 后台自动定时更新内容
- 微信公众号RSS生成（支持`.atom`、`.rss`、`.json`格式)
- 支持全文内容输出，让阅读无障碍
- 所有订阅源导出OPML

### 本仓库附带工具（部署与导出）

| 用途 | 说明 |
|------|------|
| 一键启动（Docker SQLite） | 仓库根目录 [`start-wewe-rss.sh`](./start-wewe-rss.sh)，配置示例见 [`compose.env.example`](./compose.env.example)、[`docker-compose.override.example.yml`](./docker-compose.override.example.yml)，详见下文「Windows 10…」一节。 |
| 分页导出全部文章链接 | `pnpm urls:export`（实现于 [`tools/fetch-article-urls.ts`](./tools/fetch-article-urls.ts)，默认请求间隔，避免短时间打满本地服务）。详见「批量导出文章链接」。 |
| 间隔导出正文（含 URL） | `pnpm articles:export`（[`tools/fetch-article-contents.ts`](./tools/fetch-article-contents.ts) + [`tools/article-images.ts`](./tools/article-images.ts)，默认每篇一个目录：`{id}/article.* + assets/`；`--bundle` 为单文件）。详见「导出正文（全文）」。 |
| Shell 示例 | [`scripts/extract-feed-links.example.sh`](./scripts/extract-feed-links.example.sh) |

### 高级功能

- **标题过滤**：支持通过`/feeds/all.(json|rss|atom)`接口和`/feeds/:feed`对标题进行过滤
  ```
  {{ORIGIN_URL}}/feeds/all.atom?title_include=张三
  {{ORIGIN_URL}}/feeds/MP_WXS_123.json?limit=30&title_include=张三|李四|王五&title_exclude=张三丰|赵六
  ```

- **手动更新**：支持通过`/feeds/:feed`接口触发单个feedid更新
  ```
  {{ORIGIN_URL}}/feeds/MP_WXS_123.rss?update=true
  ```

## 🚀 部署

### 一键部署

- [Deploy on Zeabur](https://zeabur.com/templates/DI9BBD)
- [Railway](https://railway.app/)
- [Hugging Face部署参考](https://github.com/cooderl/wewe-rss/issues/32)

### Docker Compose 部署

参考 [docker-compose.yml](https://github.com/cooderl/wewe-rss/blob/main/docker-compose.yml) 和 [docker-compose.sqlite.yml](https://github.com/cooderl/wewe-rss/blob/main/docker-compose.sqlite.yml)

### Windows 10：Git Bash + SQLite（一键脚本与数据目录）

- **数据位置**：SQLite 方案将数据库映射到仓库根目录 [`data/`](./data)（见 [`docker-compose.sqlite.yml`](./docker-compose.sqlite.yml)）。请把仓库放在空间充足的分区（例如 E:），避免系统盘被 Docker 镜像与数据库占满。
- **配置**：复制 [`compose.env.example`](./compose.env.example) 为 `compose.env`（已加入 `.gitignore`），可修改 `AUTH_CODE`、`SERVER_ORIGIN_URL`。若容器内需走宿主机代理（例如本机 `localhost:7890`），在 `compose.env` 中取消注释 `HTTP_PROXY` / `HTTPS_PROXY`（使用 `host.docker.internal`），或复制 [`docker-compose.override.example.yml`](./docker-compose.override.example.yml) 为 `docker-compose.override.yml`。
- **启动**（需在项目根目录执行）：
  ```sh
  ./start-wewe-rss.sh
  ```
  若希望仅为 **宿主机** 上的 `docker pull` 等命令设置代理，可执行：
  ```sh
  USE_HOST_PROXY=1 ./start-wewe-rss.sh
  ```
  脚本会拉起容器并对 `http://localhost:4000` 做就绪检测（优先使用 `docker-compose` 命令以兼容 Windows Git Bash，若无则回退 `docker compose`）。**脚本结束时会打印如何在 Cursor 内置浏览器中打开上述地址**（聊天里让 AI 用 Browser 打开，或命令面板执行 `Simple Browser: Show` 并粘贴 URL）。
- **首次配置（扫码与订阅）**：服务就绪后，优先用 **Cursor 内置浏览器** 打开 `http://localhost:4000`（与脚本末尾提示一致）。也可由助手在容器健康检查后通过 Browser MCP 导航至该地址；**微信读书登录二维码须用手机扫码**，助手无法代为扫码。**不要勾选「24 小时后自动退出」**。随后在 **公众号源** 中 **添加**，粘贴任意一篇该公众号图文的分享链接（格式 `https://mp.weixin.qq.com/s/...`）即可订阅。
- **与网页源码 `__biz` 的区别**：订阅成功后，RSS/JSON 地址为 `/feeds/<feedId>.(rss|atom|json)`，其中 `<feedId>` 为系统内标识（文档示例形如 `MP_WXS_123`），**不是**文章网页源码里的 `__biz=` 参数；请勿把二者混用。
- **导出全部文章 URL**：管理端同步完成后，可直接请求合并 Feed（`/feeds` 无需 `AUTH_CODE`）。示例见下文「批量导出文章链接」。

### Docker 命令启动

#### MySQL (推荐)

1. 创建docker网络
   ```sh
   docker network create wewe-rss
   ```

2. 启动 MySQL 数据库
   ```sh
   docker run -d \
     --name db \
     -e MYSQL_ROOT_PASSWORD=123456 \
     -e TZ='Asia/Shanghai' \
     -e MYSQL_DATABASE='wewe-rss' \
     -v db_data:/var/lib/mysql \
     --network wewe-rss \
     mysql:8.3.0 --mysql-native-password=ON
   ```

3. 启动 Server
   ```sh
   docker run -d \
     --name wewe-rss \
     -p 4000:4000 \
     -e DATABASE_URL='mysql://root:123456@db:3306/wewe-rss?schema=public&connect_timeout=30&pool_timeout=30&socket_timeout=30' \
     -e AUTH_CODE=123567 \
     --network wewe-rss \
     cooderl/wewe-rss:latest
   ```

[Nginx配置参考](https://raw.githubusercontent.com/cooderl/wewe-rss/main/assets/nginx.example.conf)

#### SQLite (不推荐)

```sh
docker run -d \
  --name wewe-rss \
  -p 4000:4000 \
  -e DATABASE_TYPE=sqlite \
  -e AUTH_CODE=123567 \
  -v $(pwd)/data:/app/data \
  cooderl/wewe-rss-sqlite:latest
```

### 本地部署

使用 `pnpm install && pnpm run -r build && pnpm run start:server` 命令 (可配合 pm2 守护进程)

**详细步骤** (SQLite示例)：

```shell
# 需要提前声明环境变量,因为prisma会根据环境变量生成对应的数据库连接
export DATABASE_URL="file:../data/wewe-rss.db"
export DATABASE_TYPE="sqlite"
# 删除mysql相关文件,避免prisma生成mysql连接
rm -rf apps/server/prisma
mv apps/server/prisma-sqlite apps/server/prisma
# 生成prisma client
npx prisma generate --schema apps/server/prisma/schema.prisma
# 生成数据库表
npx prisma migrate deploy --schema apps/server/prisma/schema.prisma
# 构建并运行
pnpm run -r build
pnpm run start:server
```

## ⚙️ 环境变量

| 变量名                   | 说明                                                                    | 默认值                      |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------- |
| `DATABASE_URL`           | **必填** 数据库地址，例如 `mysql://root:123456@127.0.0.1:3306/wewe-rss` | -                           |
| `DATABASE_TYPE`          | 数据库类型，使用 SQLite 时需填写 `sqlite`                               | -                           |
| `AUTH_CODE`              | 服务端接口请求授权码，空字符或不设置将不启用 (`/feeds`路径不需要)       | -                           |
| `SERVER_ORIGIN_URL`      | 服务端访问地址，用于生成RSS完整路径                                     | -                           |
| `MAX_REQUEST_PER_MINUTE` | 每分钟最大请求次数                                                      | 60                          |
| `FEED_MODE`              | 输出模式，可选值 `fulltext` (会使接口响应变慢，占用更多内存)            | -                           |
| `CRON_EXPRESSION`        | 定时更新订阅源Cron表达式                                                | `35 5,17 * * *`             |
| `UPDATE_DELAY_TIME`      | 连续更新延迟时间，减少被关小黑屋                                        | `60s`                       |
| `ENABLE_CLEAN_HTML`      | 是否开启正文html清理                                                    | `false`                     |
| `PLATFORM_URL`           | 基础服务URL                                                             | `https://weread.111965.xyz` |

> **注意**: 国内DNS解析问题可使用 `https://weread.965111.xyz` 加速访问

## 🔔 钉钉通知

进入 wewe-rss-dingtalk 目录按照 README.md 指引部署

## 📱 使用方式

1. 进入账号管理，点击添加账号，微信扫码登录微信读书账号。
  
   **注意不要勾选24小时后自动退出**
   
   <img width="400" src="./assets/preview2.png"/>


2. 进入公众号源，点击添加，通过提交微信公众号分享链接，订阅微信公众号。
   **添加频率过高容易被封控，等24小时解封**

   <img width="400" src="./assets/preview3.png"/>

## 📄 批量导出文章链接

合并 Feed 中每条目的正文链接为微信公众号 URL：`https://mp.weixin.qq.com/s/{id}`。仅在需要 **URL 列表**时建议使用默认模式（勿开启 `FEED_MODE=fulltext`，以免抓取正文变慢）。

**与「导出 OPML」的区别**：界面上的 **导出 OPML** 只包含各订阅源的 Atom 地址（`/feeds/{订阅 id}.atom`），便于导入其它阅读器；**不包含**单篇文章链接。若要 **全部文章 URL**，请用下方 JSON Feed / 脚本。

在容器已同步文章数据后，推荐使用 TypeScript 工具分页拉取（分页请求之间有默认间隔，可降低对服务的压力）：

```sh
pnpm install
pnpm urls:export -- --base http://localhost:4000 --feed all --delay 2000 --limit 80
```

单个公众号请将 `--feed` 设为管理后台该源的 **`feedId`**（形如 `MP_WXS_xxx`），不要使用公众号显示名称。输出为每行一条 URL；加 `--json` 则输出 JSON 数组。脚本实现见 [`tools/fetch-article-urls.ts`](./tools/fetch-article-urls.ts)。

也可用 `curl` + `jq` 单次拉一页（需自行翻页组合）：

```sh
# 安装 jq 后：导出近期条目中的 link 字段（按需调大 limit）
curl -sS "http://localhost:4000/feeds/all.json?limit=500&page=1" | jq -r '.items[] | .url // .link'
```

单公众号源将 `all` 换为管理页中该源的 `feedId`，例如：

```sh
curl -sS "http://localhost:4000/feeds/MP_WXS_123.json?limit=200&page=1" | jq -r '.items[] | .url // .link'
```

更完整的 shell 示例见 [`scripts/extract-feed-links.example.sh`](./scripts/extract-feed-links.example.sh)。纯函数测试：`pnpm test:tools`。若需立即刷新单源，可在 URL 上增加 `?update=true`（见上文「高级功能」）。

## 📥 导出正文（全文）

在已同步订阅、且 **本机 WeWe-RSS 与容器能访问** `mp.weixin.qq.com` 的前提下，可用脚本按 **极慢** 节奏拉取每篇正文并落盘。**默认每篇一个目录**：`{文章id}/article.json`（元数据 + `contentPreview` + `imagesDir` / `imageCount`）、`{文章id}/article.txt`、`{文章id}/article.html`。**默认会下载正文里 `<img>` 和内联样式 `url(...)` 指向的图片**到 `{文章id}/assets/`，并把 HTML 里的路径改成相对本地路径，便于离线打开。不需要图片时用 `--no-images`。若仍要单文件大包，可加 `--bundle`（与图片下载不兼容，会自动跳过图片）。

**机制**：脚本只请求 `http://localhost:4000/feeds/{feedId}.json?limit=1&page=P&mode=fulltext`，由服务端 [`FeedsService`](./apps/server/src/feeds/feeds.service.ts) 代为请求微信图文页；**不在本机脚本里直连微信**，与阅读器开全文的行为一致。

**风控与合规**：务必仅用于你有权访问的个人订阅内容；拉正文会显著增加请求量，可能触发 **微信侧或读书侧封控（「小黑屋」）**——默认 **45s** 基础间隔 + **0～10s** 随机抖动，可用 `--delay-ms` / `--jitter-ms` 再加大。**不在乎耗时时建议再放慢**。失败记录写入输出目录下的 `errors.log`；`--continue-on-error` 可在单页失败后继续（可能跳过篇目，慎用）。

**与 `pnpm urls:export` / OPML**：`urls:export` 只收集链接；**OPML** 只导出订阅源地址；**本命令**才写入带正文的文件。导出目录默认 `exports/articles`（已加入 `.gitignore`）。

```sh
# 建议先清理旧导出目录，避免新旧结构混在一起
rm -rf exports/articles
pnpm articles:export -- --feed MP_WXS_xxx --out-dir exports/huitianyi --delay-ms 60000 --jitter-ms 15000
# 断点续跑（已存在的 {文章id}.json 跳过）
pnpm articles:export -- --feed MP_WXS_xxx --resume --start-page 42
# 查看全部参数
pnpm articles:export -- --help
```

常用参数：`--out-dir`、`--delay-ms`、`--jitter-ms`、`--start-page`、`--max-pages`（调试）、`--resume`、`--continue-on-error`、`--bundle`（单文件 JSON 内含 HTML）、`--no-images`、`--image-delay-ms`、`--image-jitter-ms`（控制**每张图**下载间隔，与分页间隔独立；正式跑建议加大）。

测试：`pnpm test:articles`。

### 推荐使用流程（含图片、可离线打开）

```sh
# 1) 启动服务（容器）
./start-wewe-rss.sh

# 2) 清理旧导出，避免新旧结构混杂
rm -rf exports/articles

# 3) 低频导出正文（每篇一个目录，含 assets 图片）
pnpm articles:export -- --feed all --out-dir exports/articles --delay-ms 60000 --jitter-ms 15000 --image-delay-ms 8000 --image-jitter-ms 4000 --continue-on-error
```

导出结构示例：

```text
exports/articles/
  <articleId>/
    article.json
    article.txt
    article.html
    assets/
      img_001.jpg
      img_002.png
      ...
```

打开 `exports/articles/<articleId>/article.html` 即可查看该篇文章正文与本地图片。若你只想看纯文本，打开同目录的 `article.txt`。

## 🔑 账号状态说明

| 状态       | 说明                                                                |
| ---------- | ------------------------------------------------------------------- |
| 今日小黑屋 | 账号被封控，等一天恢复。账号正常时可通过重启服务/容器清除小黑屋记录 |
| 禁用       | 不使用该账号                                                        |
| 失效       | 账号登录状态失效，需要重新登录                                      |

## 💻 本地开发

1. 安装 nodejs 20 和 pnpm
2. 修改环境变量：
   ```
   cp ./apps/web/.env.local.example ./apps/web/.env
   cp ./apps/server/.env.local.example ./apps/server/.env
   ```
3. 执行 `pnpm install && pnpm run build:web && pnpm dev` 
   
   ⚠️ **注意：此命令仅用于本地开发，不要用于部署！**
4. 前端访问 `http://localhost:5173`，后端访问 `http://localhost:4000`

## ⚠️ 风险声明

为了确保本项目的持久运行，某些接口请求将通过 `weread.111965.xyz` 进行转发。请放心，该转发服务不会保存任何数据。

## ❤️ 赞助

如果觉得 WeWe RSS 项目对你有帮助，可以给我来一杯啤酒！

**PayPal**: [paypal.me/cooderl](https://paypal.me/cooderl)

## 👨‍💻 贡献者

<a href="https://github.com/cooderl/wewe-rss/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=cooderl/wewe-rss" />
</a>

## 📄 License

[MIT](https://raw.githubusercontent.com/cooderl/wewe-rss/main/LICENSE) @cooderl

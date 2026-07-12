# Enterprise AI Agent Platform

可本地運行及容器化部署的多租戶 AI Agent 管理平台。平台以工作區為執行與計費邊界，提供 Provider 連接、Agent 草稿與版本發布、SSE 串流對話、經驗證工具、文字型 RAG、用量成本、審計記錄及企業 RBAC。

## 技術棧

- Monorepo：pnpm workspace、TypeScript
- Web：Next.js、React、Tailwind CSS
- API：NestJS、OpenAPI、SSE
- 資料：PostgreSQL、Prisma ORM
- 基礎設施：Redis、S3 相容儲存（本地使用 MinIO）
- 測試：Jest/Vitest、Playwright
- 部署：Docker Compose、Kubernetes 範例

## 目錄

```text
apps/api                 NestJS API、Prisma schema/migrations/seed
apps/web                 Next.js 管理介面
packages/shared          跨應用型別與常數
tests/e2e                Playwright API 與瀏覽器煙霧測試
docker                   API/Web 多階段 Dockerfiles
deploy/kubernetes        生產 Kubernetes 基線
docs                     架構、ERD、安全及操作指南
```

## Docker 一鍵啟動

前置條件：Docker Engine 24+ 與 Docker Compose v2。

```powershell
Copy-Item .env.example .env
# 編輯 .env，填入 POSTGRES_PASSWORD、S3_ACCESS_KEY、S3_SECRET_KEY、JWT_*、ENCRYPTION_KEY 與 BOOTSTRAP_TOKEN
pnpm docker:up
pnpm docker:compose -- --profile seed run --rm seed
pnpm docker:compose -- ps
```

產生 32-byte AES key（PowerShell）：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

服務入口：

- 管理介面：<http://localhost:3000>
- API：<http://localhost:4000/api/v1>
- Swagger：<http://localhost:4000/docs>
- MinIO Console：<http://localhost:9001>

`migrate` 服務會在 API 啟動前執行已提交的 Prisma migrations；`minio-init` 會建立 private bucket。`seed` profile 是顯式操作，避免每次啟動重設管理資料。

`docker:compose` 包裝器在 Windows 工作區路徑含非 ASCII 字元時會建立指向同一目錄的暫時 ASCII junction，以避開 Docker Desktop build-session 限制；Linux/macOS 會直接執行原生 `docker compose`。Web/API 與基礎設施預設只綁定 loopback，需要區域網存取時才顯式調整 `WEB_BIND_ADDRESS`/`API_BIND_ADDRESS`。

## Ubuntu 一鍵部署

支援 Ubuntu 的部署腳本會安裝官方 Docker Engine/Compose plugin、產生高強度 secrets、建立 root-only `.env`、建置並啟動服務、執行 migration/seed，以及等待 API/Web 健康檢查。預設安全模式只綁定 `127.0.0.1`：

```bash
curl -fsSL https://raw.githubusercontent.com/PuneetGOTO/AI-Agent-Help/main/scripts/deploy-ubuntu.sh | sudo bash
sudo cat /var/lib/ai-agent-platform/admin-credentials
```

從工作站建立 tunnel 後開啟 <http://localhost:3000>：

```bash
ssh -L 3000:127.0.0.1:3000 USER@SERVER
```

公開部署必須先把 DNS A/AAAA 指向伺服器並開放 TCP 80/443、UDP 443；指定網域後腳本會啟用 Caddy 自動 HTTPS：

```bash
curl -fsSL https://raw.githubusercontent.com/PuneetGOTO/AI-Agent-Help/main/scripts/deploy-ubuntu.sh | \
  sudo bash -s -- --domain agents.example.com \
  --admin-email owner@example.com --acme-email ops@example.com
```

腳本預設要求 Docker data root 至少有 15 GiB 可用空間，不會自動 prune、刪除 volume 或覆蓋既有 `.env`。完整選項與更新方式見 [Ubuntu 部署章節](docs/deployment.md#ubuntu-一鍵部署)。

## 管理員初始化

有兩種互斥且可重複檢查的方式：

1. 全新環境在登入頁依 bootstrap 畫面建立第一位 Owner、Organization 與 Workspace。Production 必須輸入部署 secret manager 中的 `BOOTSTRAP_TOKEN`；它只由 `X-Bootstrap-Token` header 傳送，初始化後應從部署環境移除。API 狀態可由 `GET /api/v1/auth/bootstrap/status` 查詢。
2. 部署前設定 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME`、`DEFAULT_ORGANIZATION_NAME`、`DEFAULT_WORKSPACE_NAME`，再執行 `pnpm db:seed` 或 Compose 的 `seed` profile。

Seed 密碼只適合本地初始化。Production seed 不提供預設管理員帳密，必須由 secret manager 注入一次性高熵密碼；重跑 seed 不會重新啟用帳戶或把既有成員升為 Owner。

## 原生開發

前置條件：Node.js 22、pnpm 10、Docker。

```powershell
corepack enable
pnpm install
docker compose up -d postgres redis minio minio-init
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web 與 API 預設分別使用 `3000`、`4000`。瀏覽器公開 API URL 使用 `NEXT_PUBLIC_API_URL`；Next.js server-side proxy 使用 `API_PROXY_URL` 或 `API_URL`。

## 驗證

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
docker compose config --quiet
```

Playwright 預期 Web/API 已啟動。認證測試使用 `E2E_ADMIN_EMAIL`、`E2E_ADMIN_PASSWORD`；未提供時只略過登入後案例，公開健康、安全邊界與 UI 煙霧測試仍會執行。CI 另啟動 `tests/e2e/fixtures/openai-compatible-server.mjs`，透過 `E2E_MOCK_PROVIDER_URL` 驗證完整 Agent 建立、版本、發布、同步/SSE、usage 與回滾路徑。真實供應商 canary 只在受保護環境設定 `E2E_LIVE_AGENT_ID`。

## API 使用

所有管理 API 位於 `/api/v1`。登入後請傳送 Bearer access token，工作區資源同時要求：

```http
Authorization: Bearer <access-token>
X-Organization-Id: <organization-uuid>
X-Workspace-Id: <workspace-uuid>
```

串流對話使用 `POST /api/v1/agents/{agentId}/chat/stream`，回應為 `text/event-stream`。反向代理必須停用 buffering 並提高 read timeout。完整契約以 Swagger/OpenAPI 為準，常用路由見 [API 指南](docs/api.md)。

## Provider 憑證

Provider API key/AWS credential 只提交到 API。伺服器使用 AES-256-GCM 儲存，列表/詳情回應不傳回明文，錯誤與審計 metadata 亦須先清理。平台內建 OpenAI、Azure OpenAI、Anthropic、Google Gemini、AWS Bedrock、Ollama 與 OpenAI-compatible 真實 adapter，並按 provider/model 能力決定聊天、串流、工具、結構輸出及 embeddings。平台級 `OPENAI_API_KEY` 只供明確的初始化流程使用；正常多租戶操作應建立工作區 Provider Connection。

知識庫目前對 text/plain、Markdown、JSON、CSV 提供同步 lexical retrieval；PDF/Office 與 embedding/vector pipeline 見 [已知限制](docs/unfinished.md)。

擴充新的供應商時不得在 Agent service 寫供應商分支，請依 [Provider 擴展指南](docs/provider-extension.md) 實作 adapter 與 capability detection。

## 文件

- [架構與執行流程](docs/architecture.md)
- [實作計劃與驗收矩陣](docs/implementation-plan.md)
- [資料庫 ERD](docs/erd.md)
- [架構決策記錄](docs/architecture-decisions.md)
- [API 指南](docs/api.md)
- [開發與生產部署](docs/deployment.md)
- [Provider 擴展指南](docs/provider-extension.md)
- [安全威脅與控制](docs/security.md)
- [已知限制與未完成項目](docs/unfinished.md)

## 生產前必要事項

- 使用受管 PostgreSQL/Redis/S3、TLS、secret manager、集中式日誌與監控。
- 將所有範例憑證輪替；`COOKIE_SECURE=true`，只允許精確的 `WEB_URL` origins。
- 在 ingress/API gateway 設定 request body、速率、連線數與 SSE timeout 限制。
- 對 Provider 與工具目的地實施 egress allowlist；禁止 private/link-local/metadata IP。
- `OLLAMA_ALLOWED_BASE_URLS` 只列部署管理員批准的精確 URL；租戶選擇 Ollama 不會自動取得私網存取權。
- `BEDROCK_ALLOWED_ENDPOINTS` 預設為空；只有部署端受控 proxy 才加入精確 HTTPS origin，官方 AWS Bedrock endpoint 會依連接 region 驗證。
- 執行 migrations、備份還原演練、租戶隔離測試及真實 Provider canary。

詳細清單見 [部署指南](docs/deployment.md) 與 [安全文件](docs/security.md)。

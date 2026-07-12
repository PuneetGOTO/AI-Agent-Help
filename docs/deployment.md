# 開發與生產部署指南

## 環境設定

以 `.env.example` 建立環境檔。以下值不得沿用範例：

- `POSTGRES_PASSWORD`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`
- `JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`（不同且至少 32 字元）
- `ENCRYPTION_KEY`（base64 編碼的 32 random bytes）
- `ADMIN_PASSWORD`（只在 seed 初始化時使用）
- `BOOTSTRAP_TOKEN`（production 首位 Owner 初始化的一次性高熵 token，至少 32 字元）

Production 啟動會 fail closed：拒絕範例 JWT/AES/資料庫密碼、相同 JWT secrets、無效 CORS origin，以及 public origin 搭配 `COOKIE_SECURE=false`。`S3_ENDPOINT` 在 public production 必須是精確 HTTPS origin；Docker Compose 的 loopback profile 才允許內部 MinIO HTTP。若啟用 Ollama，`OLLAMA_ALLOWED_BASE_URLS` 必須列出部署端批准的精確 base URL；預設為空。Bedrock 預設只接受與 region 相符的官方 AWS hostname；部署端自管 proxy 必須加入 `BEDROCK_ALLOWED_ENDPOINTS` 精確 HTTPS origin。

Gemini Developer API 使用加密儲存的 API key。Gemini Vertex 模式使用 workload identity / Google Application Default Credentials，Provider 記錄只保存 project ID 與 location；Kubernetes、VM 或本機執行環境需另行配置最小權限 IAM，禁止將 service-account JSON 放入 Provider 公開 config。

Compose 使用內部 `http://minio:9000` 時會顯式設定 `S3_ALLOW_INSECURE_INTERNAL_ENDPOINT=true`。此例外只接受 `minio`/loopback 等內部主機名；外部 S3 endpoint 即使開啟旗標仍必須使用精確 HTTPS origin。Kubernetes 與受管 S3 預設保持 `false`。

`NEXT_PUBLIC_API_URL` 會在 Next.js build 時寫入 browser bundle，不能包含 secret，也不能期待在已建置 image 啟動時才變更。server-side rewrite 目的地使用 `API_PROXY_URL`/`API_URL`。

本地 E2E 若使用 `E2E_MOCK_PROVIDER_URL=http://127.0.0.1:4010/v1`，啟動 API 前也要把同一精確 URL 放入 `OLLAMA_ALLOWED_BASE_URLS`；CI 已預設設定。真實 Anthropic/Gemini/Bedrock canary 必須只由受保護 CI secret 注入，不能提交 credential。

## Ubuntu 一鍵部署

腳本支援 Ubuntu、systemd 與 apt，適用於單機 Compose baseline。它會：

- 在缺少 Docker 時加入 Docker 官方 apt repository，安裝 Engine、Buildx 與 Compose plugin；若偵測到會衝突的 Ubuntu Docker/containerd 套件則 fail closed，不會擅自移除既有 workload 套件。
- 在新部署產生 PostgreSQL、MinIO、JWT、AES 與管理員高熵憑證；新舊 `.env` 均強制修復為 `root:root 0600`，因此腳本必須以 root 執行。
- 在建置前檢查 system filesystem 與 Docker data root 空間；預設 Docker root 至少需要 15 GiB。
- 在耗時 build 前檢查 Web/API/PostgreSQL/Redis/MinIO 與可選 Caddy 的 host ports；同一 Compose 專案已運行時允許安全重跑。
- 執行 `docker compose config`、image build、migration、seed 與健康檢查。
- 重跑時保留既有 `.env`、資料 volumes 與管理員密碼；不執行 prune 或 `down -v`。
- Compose stateful/proxy images 與 Dockerfile Node base 使用 multi-architecture digest 固定；升級時需在 CI 掃描後更新 digest，不能只把 tag 改回 `latest`。

在已 clone 的 repository 中執行：

```bash
sudo bash scripts/deploy-ubuntu.sh
```

或從空白 Ubuntu 主機下載執行，腳本會 clone `main` 到 `/opt/ai-agent-help`：

```bash
curl -fsSL https://raw.githubusercontent.com/PuneetGOTO/AI-Agent-Help/main/scripts/deploy-ubuntu.sh | sudo bash
```

預設所有 host ports 綁定 `127.0.0.1`。從管理工作站建立 SSH tunnel：

```bash
ssh -L 3000:127.0.0.1:3000 USER@SERVER
```

網域 HTTPS 模式：

```bash
curl -fsSL https://raw.githubusercontent.com/PuneetGOTO/AI-Agent-Help/main/scripts/deploy-ubuntu.sh | \
  sudo bash -s -- --domain agents.example.com \
  --admin-email owner@example.com --acme-email ops@example.com
```

只有公網 IPv4、尚未配置網域時，可使用明確的臨時 HTTP 模式：

```bash
sudo bash scripts/deploy-ubuntu.sh --public-ip 38.76.163.32 --configure-ufw
```

此模式會把 Caddy 發布到 host TCP 80，Web/API 仍只存在 Docker private network 或 loopback；PostgreSQL、Redis、MinIO 與 API 4000 不會公開。`ALLOW_INSECURE_PUBLIC_HTTP=true` 只對單一 HTTP IP origin 有效，不能用來開放 HTTP 網域。由於 HTTP 無法保護登入密碼、refresh cookie、prompt 與文件內容，它只適合短期驗證，應儘快切換至 `--domain` HTTPS 模式。

`--configure-ufw` 只加入所需 allow rules，不會自動啟用 UFW，以免鎖死既有 SSH。雲端 security group、VPC firewall 或供應商控制台仍需另外開放 inbound TCP 80；HTTPS 模式還需要 TCP/UDP 443。

使用網域模式前，DNS 必須已指向伺服器，安全群組/防火牆必須允許 TCP 80/443 與 UDP 443。Caddy 將同源 `/api/v1/*` 直接代理到內部 API，並停用 SSE response buffering；其他路徑代理到 Web，因此 3000、4000、5432、6379、9000、9001 均不需公開。Ubuntu 腳本設定 `TRUST_PROXY_HOPS=1`，讓 rate limit/audit 使用 Caddy 傳入的原始 client IP；若再增加 CDN/LB，必須按實際拓撲調整跳數，不能設為無限制信任。

管理員密碼不直接輸出到一般部署 log。新部署完成後讀取 root-only 檔案：

```bash
sudo cat /var/lib/ai-agent-platform/admin-credentials
```

常用選項：`--install-dir`、`--skip-docker-install`、`--skip-seed`、`--domain`、`--public-ip`、`--configure-ufw`、`--admin-email`、`--acme-email`。可透過 `ADMIN_PASSWORD`、`DEPLOY_TIMEOUT`、`MIN_FREE_GB`、`REPO_URL`、`REPO_BRANCH` 環境變數覆寫安全預設；不要把 `ADMIN_PASSWORD` 寫入 shell history 或 CI log。

更新現有 checkout 時，先在維護窗口內備份資料再重跑腳本。乾淨的 Git checkout 會自動對目前 `REPO_BRANCH` 執行 `git pull --ff-only`；偵測到 tracked/untracked 本機修改、detached HEAD 或其他分支時會 fail closed。從不具自動更新功能的舊版腳本升級時，需先手動執行一次 `git pull --ff-only`。腳本會執行已提交 migration 並保留 volumes。回滾 application image 前必須確認 migration 仍向後相容。

`raw.githubusercontent.com/.../main` 適合首次人工安裝；正式自動化應把下載 URL 固定到已審查的 commit SHA，並驗證 checksum/signature，避免分支移動造成未審查程式以 root 執行。

## Docker Compose

完整啟動：

```bash
pnpm docker:up
pnpm docker:compose -- --profile seed run --rm seed
pnpm docker:compose -- ps
pnpm docker:compose -- logs --tail=100 api web
```

Compose dependency graph：PostgreSQL healthy → migration 完成；MinIO healthy → private bucket 建立；Redis healthy + migration + bucket → API；API healthy → Web。容器內連線使用 `postgres`、`redis`、`minio` 服務名，不能使用 `localhost`。

包裝器只處理 Compose 啟動方式，不改寫任何設定；Windows 路徑含中文或其他非 ASCII 字元時，它會使用 deterministic junction 作為 Docker build context，避免 Docker Desktop 的 session header 失敗。Web/API 及資料服務預設 bind 到 `127.0.0.1`；只有在受控網路與防火牆政策下才改為其他位址。

只啟動開發依賴：

```bash
pnpm docker:compose -- up -d postgres redis minio minio-init
```

停止但保留資料：`docker compose down`。`docker compose down -v` 會永久刪除本地資料卷，只應在明確要重建開發資料時使用。

## 建置 production images

```bash
docker build -f docker/api.Dockerfile --target runtime \
  -t registry.example.com/agent-platform-api:VERSION .
docker build -f docker/api.Dockerfile --target migration \
  -t registry.example.com/agent-platform-migration:VERSION .
docker build -f docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://agents.example.com/api/v1 \
  --build-arg API_PROXY_URL=http://agent-platform-api:4000 \
  -t registry.example.com/agent-platform-web:VERSION .
docker push registry.example.com/agent-platform-api:VERSION
docker push registry.example.com/agent-platform-migration:VERSION
docker push registry.example.com/agent-platform-web:VERSION
```

以 immutable digest 部署，保留 SBOM 與 vulnerability scan 結果。基礎 image 目前以 major tag 表示開發相容性；受控 release pipeline 應鎖定已掃描 digest 並由自動化 dependency PR 更新。

## Kubernetes

`deploy/kubernetes` 假設已有：受管 PostgreSQL/Redis/S3、NGINX Ingress、Metrics Server、TLS 憑證流程及 secret manager。

1. 替換 ConfigMap domain/bucket 與所有 image reference。
2. 建置 Web image 時使用相同 public API URL，並把 `API_PROXY_URL` 設為叢集內 API Service。
3. 建立 namespace 與 secret，再先執行 migration Job。
4. migration 成功後才 rollout workloads。

```bash
kubectl apply -f deploy/kubernetes/namespace.yaml
kubectl apply -f deploy/kubernetes/service-account.yaml
kubectl apply -f deploy/kubernetes/configmap.yaml
# 由 External Secrets/Sealed Secrets/Vault 建立 agent-platform-secrets
kubectl apply -f deploy/kubernetes/migration-job.yaml
kubectl wait --for=condition=complete --timeout=300s \
  job/agent-platform-migrate -n agent-platform
kubectl apply -k deploy/kubernetes
kubectl rollout status deployment/agent-platform-api -n agent-platform
kubectl rollout status deployment/agent-platform-web -n agent-platform
```

`secret.example.yaml` 只列 required keys，禁止填入實值後提交。若 migration Job 名稱已存在，release pipeline 應使用帶 release ID 的新名稱或先確認舊 Job 已完成再替換。

首位 Owner 建立後，立即從 workload secret 移除 `BOOTSTRAP_TOKEN` 並 rollout API。後續 `/auth/bootstrap` 仍會因平台已初始化而拒絕，但移除一次性憑證可縮小暴露面。

Ingress 已關閉 SSE buffering 並設定長 read timeout；依實際最大 run timeout 收緊。若使用其他 ingress/controller，需轉譯 annotations。NetworkPolicy 假設 ingress controller namespace 名為 `ingress-nginx`；不相符時必須修改，否則流量會被拒絕。

## Migration 與回滾

- schema migration 採 expand/contract：先加入向後相容欄位/index，再部署讀寫程式，最後於後續 release 移除舊欄位。
- production 只執行 `prisma migrate deploy`，禁止 `migrate dev` 或 `db push`。
- migration 前建立可驗證的 snapshot；大型 index 使用 PostgreSQL 線上策略並評估 lock。
- 應用回滾使用前一個 image digest。若 migration 非向後相容，不可只回滾程式。
- Agent 業務回滾使用發布 API 指向既有版本，與資料庫 migration 回滾是不同操作。

## 備份與災難復原

| 資料       | 最低策略                                                       | 還原驗證                                         |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------ |
| PostgreSQL | PITR + 每日 snapshot，跨區複本依 RPO                           | 定期還原至隔離環境並跑 tenant/count checks       |
| S3         | versioning、server-side encryption、lifecycle/retention        | 抽樣下載、hash 與 metadata 對照                  |
| Redis      | 非 system of record；視 queue 需求啟用 AOF/managed persistence | 故障切換後驗證 rate/queue 恢復                   |
| Secret/KMS | provider-managed backup 與雙人復原程序                         | 定期測試 key access，不匯出 plaintext master key |

先定義 RPO/RTO 再選服務層級。只有「備份成功」訊息而沒有 restore drill 不算可恢復。

## 擴展與容量

- API/Web 水平擴展；HPA baseline 以 CPU 70%，生產應加入 request latency、active streams、queue depth。
- 每個 workspace 的 concurrency limit 必須由 Redis 原子協調，不能依單一 pod 記憶體計數。
- SSE 每連線長時間佔用 socket；規劃 ingress/API file descriptor、keepalive 與最大連線數。
- BullMQ worker 依 queue depth 獨立擴展；tool/Webhook side effect 需 idempotency key。
- PostgreSQL pool 上限為 `replica × pool size + jobs`，不得超過資料庫連線預算。

## 監控與告警

最低監控：

- HTTP request rate/error/latency（按 route template，不以完整 URL 作 label）
- active Agent runs/streams、provider latency/error、tool approval/timeout
- input/output tokens、實際/估算 cost、workspace budget utilization
- queue depth/age/failure、PostgreSQL pool/slow query、Redis memory/eviction
- 401/403/429 spike、bootstrap attempt、credential validation/audit events

日誌使用 request ID、run ID 與 tenant IDs 關聯，但不可記錄 Authorization/cookie/API key、完整 prompt/document 或 Provider 原始錯誤。告警通知也必須經過相同遮罩。

## 發布檢查表

- CI 的 generate/validate/migrate、lint、typecheck、unit、build、E2E 全部通過。
- 新 migration 已在 production-size clone 評估 lock/時間。
- image 已簽章、掃描並以 digest 固定；SBOM 已保存。
- secrets、CORS origins、TLS、cookie、ingress limit、egress allowlist 已設定。
- Provider canary 成功；capability/cost mapping 已確認。
- dashboard/alert、備份與回滾 owner 已指定。

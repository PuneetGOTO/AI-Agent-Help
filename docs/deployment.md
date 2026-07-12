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

`NEXT_PUBLIC_API_URL` 會在 Next.js build 時寫入 browser bundle，不能包含 secret，也不能期待在已建置 image 啟動時才變更。server-side rewrite 目的地使用 `API_PROXY_URL`/`API_URL`。

本地 E2E 若使用 `E2E_MOCK_PROVIDER_URL=http://127.0.0.1:4010/v1`，啟動 API 前也要把同一精確 URL 放入 `OLLAMA_ALLOWED_BASE_URLS`；CI 已預設設定。真實 Anthropic/Gemini/Bedrock canary 必須只由受保護 CI secret 注入，不能提交 credential。

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

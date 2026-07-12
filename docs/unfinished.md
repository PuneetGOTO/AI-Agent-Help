# 已知限制與未完成項目

此清單用來避免把基線功能誤認為所有企業環境均已完成的控制。每個項目在投入生產前應依實際需求建立 owner、風險等級與驗收測試。

## 功能

- OpenAI/Azure/OpenAI-compatible/Ollama、Anthropic、Google Gemini 與 AWS Bedrock 均已註冊真實官方協定/SDK adapter，包含模型清單、聊天、串流、usage 與各自支援的工具/結構輸出/embedding 路徑。Anthropic 明確不宣告 embeddings；Bedrock embeddings 限於已映射的 Titan/Cohere 模型。所有供應商仍需受控真實 credential canary、區域/模型差異測試與版本化 pricing metadata。
- Knowledge Base 已提供 workspace-scoped S3 物件、UTF-8 text/Markdown/JSON/CSV ingestion、大小受限 chunking、chunk metadata、刪除清理及 ACL-aware lexical retrieval。PDF/Office parser、embedding/vector index、重嵌入與大規模非同步 ingestion 仍需完成。
- 長期記憶的 consent、摘要/抽取策略、可見/可刪除 UI 及 retention 尚需完成；短期 conversation history 不等同長期記憶。
- HTTP/Webhook 已有 schema validation、workspace domain allowlist、DNS private-network check、timeout/response limit、GET/HEAD retry，以及 Run 詳情中的人工 approve/reject 操作；Tool config 不回傳前端，發布版本使用中的執行 policy 禁止原地修改。仍需 immutable ToolVersion、approval arguments hash、approval 後續 LLM durable resume/idempotency、完整 response sanitizer 與專用審批佇列。Database/Custom Function 目前不可執行，inbound webhook signature/replay 防護亦未完成。
- Invitation token acceptance/register、custom role CRUD 與 Agent-scoped API token 已接通；mail delivery、conversation sharing/revocation 與可嵌入 widget 仍需完整 end-to-end 流程。
- 每日 conversation retention baseline 已存在，訊息寫入會更新活躍時間；standalone run/tool payload、S3/vector/cache/backup、legal hold、export 與帳戶/租戶刪除流程尚未完成。S3 刪除仍需 durable cleanup outbox 處理 DB 成功但 object cleanup 失敗的孤兒物件。

## 平台與營運

- Redis workspace Agent rate/concurrency、公開 auth/invitation route limiter 與 BullMQ maintenance baseline 已接通；其他 management route limiter、active SSE cap、durable side-effect worker、dead-letter/replay 操作介面仍需 production hardening。
- Cost 計算需要版本化 provider/model price catalog、currency/region/cache-token 規則與 provider invoice reconciliation；未知模型不能默認零成本。
- 健康端點、結構化 log 與 usage/audit 資料可用；Prometheus/OpenTelemetry traces、SLO dashboard、alerts 與 SIEM export 尚未隨本 repo 打包。
- Kubernetes 是受管 stateful services 的部署 baseline，不包含特定雲端的 Terraform、ExternalSecret、certificate issuer、FQDN egress policy 或 multi-region disaster recovery。
- AES master key 由 deployment secret 提供；KMS/HSM envelope encryption、線上 re-encryption 與 key version 管理尚未實作。
- Audit interceptor 目前是 best-effort 非同步寫入，不是 durable compliance log；需 transactional outbox、集中 WORM/SIEM sink 與讀取事件審計。
- OpenAI-style Provider JSON/SSE response 已設總量與 event cap；knowledge upload 仍使用最多 20 MB 記憶體 buffer，高負載部署需 streaming parser、per-tenant upload/concurrency quota。
- Workspace/Agent budget 在缺少模型 pricing 時會 fail closed，但尚不是 atomic reservation，並發執行仍可能超額；未啟用預算的未知模型會標成零估算。正式計費需 price catalog、reservation/settlement 與 provider invoice reconciliation。
- 一般 Provider 仍有 DNS preflight 到實際連線的 TOCTOU；正式工具/Provider egress 應透過 IP-pinning proxy/network policy。Gemini 因官方 SDK 無 redirect hook而限制為 Google 官方 hostname；Ollama 僅由部署端精確 allowlist 開放私網，均不代表完整 egress isolation。
- Refresh/JWT/AES/Provider secrets 的多 key 輪替流程尚未自動化；安全文件中的輪替章節是目標設計，不是現有 job。
- API key 目前只允許 read/run scope；尚未建立獨立 service-principal/actor 資料模型，因此刻意不支援管理寫入 scope。
- 沒有內建企業 IdP SSO/SCIM/MFA。高合規企業應在正式開放前加入並完成 break-glass 流程。

## 驗證缺口

- Playwright 基線覆蓋 health、OpenAPI、匿名保護、管理員登入、write-only Provider credential、Agent publish/同步與 SSE/rollback、偽造 workspace context 及登入頁；外部真實 Provider canary、tool approval、knowledge upload/retrieval 及兩個真實租戶間的完整 IDOR 矩陣仍需在具對應 fixture/secret 的受控 CI 環境執行。
- Load/soak、長 SSE 斷線、Provider rate-limit、queue failover、PostgreSQL failover、備份還原及 object deletion 尚需按目標 SLO 執行。
- 正式發布前需要獨立安全評估，特別是 SSRF/tool egress、prompt injection、租戶隔離、secret redaction 與 webhook replay。

本清單應在功能完成時連同測試與操作手冊一起更新，不能只刪除文字。

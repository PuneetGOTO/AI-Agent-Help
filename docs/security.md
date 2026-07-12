# 安全威脅模型與控制

## 保護目標與信任邊界

高價值資產包括 Provider credentials、使用者/refresh/API tokens、prompt/document 內容、工具輸入輸出、tenant metadata、usage/cost 與 audit evidence。主要邊界為：瀏覽器 ↔ ingress/API、API ↔ Provider、API ↔ 工具目的地、API ↔ PostgreSQL/Redis/S3，以及管理員 ↔ secret/deployment plane。

Organization/Workspace header、Provider/tool response、uploaded document、model output 與 prompt 中的指令全部視為不可信。模型不是授權主體；它提出的 tool call 必須通過與一般 API 相同或更嚴格的 policy。

## 已實作與部署控制

| 威脅                       | 控制                                                                                                                                                        | 殘餘風險/生產動作                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Provider key 洩漏          | AES-256-GCM、每筆 random IV/auth tag；列表不需要解密；錯誤 filter 遮罩常見 key/token                                                                        | 主 key 仍由單一環境 secret 提供；高規模改 KMS envelope encryption 及輪替 job                                            |
| 密碼/refresh token DB 洩漏 | bcrypt cost 12；refresh/opaque token 只存 HMAC/hash；refresh cookie HttpOnly、SameSite=Strict、Secure 可設定                                                | 加入 breach-password/MFA/SSO 與異常 session 偵測                                                                        |
| IDOR/跨租戶讀取            | TenantGuard 驗證 membership 與 workspace.organizationId；API key 禁止 session-only route；RBAC permission guard；非 Owner 角色委派受 permission-subset 限制 | 每個 domain query 仍需帶 tenant predicate；用雙租戶 integration tests 持續驗證                                          |
| SQL injection              | Prisma parameterized queries；DTO whitelist/validation                                                                                                      | DATABASE_QUERY tool 禁止 raw arbitrary SQL，應採 read-only DSN、parser/allowlist、statement timeout                     |
| XSS                        | React 預設 encoding、Helmet security headers、JSON DTO validation                                                                                           | Markdown/HTML/structured model output 必須 sanitize；部署 CSP，禁止危險 `dangerouslySetInnerHTML`                       |
| CSRF                       | access token header；refresh cookie SameSite=Strict；精確 CORS allowlist                                                                                    | 若改 SameSite/domain 或跨站嵌入 auth，必須加入 CSRF token + Origin/Referer 驗證                                         |
| Proxy/IP spoofing          | Express proxy trust 預設為 0；Compose/Caddy 與 Kubernetes 只設定明確 `TRUST_PROXY_HOPS`，供 IP rate limit/audit 使用                                        | CDN/LB/ingress 拓撲改變時需重新計算 hop count；禁止布林 `true` 或任意來源信任                                           |
| Secret 出現在 error/log    | 統一 exception filter 不回 stack/query string，500 只記 exception name；遞迴敏感欄位遮罩；request ID                                                        | 結構化 logger/APM exporter 也需中央 redaction；不得記完整 body/header/provider raw error                                |
| 首次部署接管               | production 要求 `BOOTSTRAP_TOKEN` header、constant-time compare、Serializable 單 Owner 建立                                                                 | 初始化後從 secret/workload 移除 token；ingress 仍應限制 bootstrap route                                                 |
| 不安全預設值               | production 啟動拒絕範例 JWT/AES/DB secret、相同 JWT secret、public origin 非 Secure cookie                                                                  | Secret manager、KMS 與 release policy 仍是部署責任                                                                      |
| 容器權限提升               | Docker USER node；Kubernetes runAsNonRoot、read-only rootfs、drop ALL、no service account token                                                             | 掃描/sign images，以 Pod Security Admission restricted 執行                                                             |
| 流量竊聽                   | Kubernetes ingress TLS baseline；public production 強制 secure cookie；外部 S3 強制 HTTPS，Compose 內部 MinIO HTTP 需要明確旗標                             | DB/Redis/provider 全部使用 TLS；`S3_ALLOW_INSECURE_INTERNAL_ENDPOINT` 只可用於私有 Docker network；內部 mTLS 依合規需要 |
| 臨時公網 IP HTTP           | 只有單一明確 IP origin、`COOKIE_SECURE=false` 與 `ALLOW_INSECURE_PUBLIC_HTTP=true` 同時成立才啟用；HTTP 網域仍拒絕                                          | 無 TLS，登入/Session/prompt 均可被竊聽或竄改；只供短期驗證，正式使用必須切換網域 HTTPS                                  |
| 供應鏈                     | lockfile frozen install、CI verify、最小 GitHub permissions                                                                                                 | release 加 SBOM、signature、dependency/image scanning 與 digest pinning                                                 |

## SSRF 與工具執行

HTTP/Webhook/base URL 是最重要的 server-side 邊界，只有字串 domain allowlist 不足。每次連線及 redirect 都必須：

1. parse 為 URL，拒絕 userinfo、fragment、非允許 scheme/port；預設只允許 HTTPS。
2. 將 hostname 正規化（IDNA/trailing dot），與 workspace allowlist 做 exact host 或明確 subdomain match。
3. DNS resolve 後拒絕 loopback、private、link-local、multicast、unspecified、IPv4-mapped IPv6 與雲端 metadata ranges。
4. 防止 DNS rebinding：目前 runtime 在 request 前執行 DNS preflight 並拒絕 private 結果；Ollama 私網例外只可由部署端 `OLLAMA_ALLOWED_BASE_URLS` 精確授權。正式環境仍應使用 egress proxy 或 socket-level IP pinning，因一般 `fetch` 解析與連線之間存在 TOCTOU 競態。redirect 一律禁止。
   Anthropic/OpenAI adapters 顯式拒絕 redirect；Gemini SDK 的 models API 無 redirect hook，因此平台只接受 Google 官方 Gemini/Vertex hostname，避免租戶代理 redirect SSRF。Bedrock 只接受同 region 官方 hostname 或部署端 `BEDROCK_ALLOWED_ENDPOINTS` 精確批准的 HTTPS origin，且仍拒絕私網解析。
5. 限制 request/response bytes、connect/overall timeout、redirect 次數、方法與 headers；不允許轉發平台 Authorization/cookie。

DATABASE_QUERY/CUSTOM_FUNCTION 目前只接受註冊 `handlerId` 定義，runtime 不執行 arbitrary SQL 或 shell；真正 handler registry 尚未實作。HTTP/Webhook 高風險工具可建立 `WAITING_APPROVAL`，但 production 尚需 immutable ToolVersion、arguments hash、expiry、durable resume 與 idempotency。

Inbound webhook HMAC/replay 接收端尚未實作。新增時必須讓簽名覆蓋 timestamp + raw body、constant-time compare、限制時間窗並保存 nonce/idempotency key；secret 需支援 current/previous 輪替。現有 outbound webhook 只套用一般 HTTP tool policy。

## Prompt injection 與資料外洩

- system/developer policy 與 retrieved/user/tool content 使用結構化 message boundary，不把文件文字拼成最高權限指令。
- RAG ingestion 標記來源、租戶、ACL 與內容類型；檢索時再次驗證 ACL，不能跨 workspace 共用未分區向量 namespace。
- model output/tool arguments 永遠不代表授權；執行前以 JSON Schema、RBAC、domain/data policy 驗證。
- Tool response 限制為 1 MB，送回模型時截斷為 20 KB 並標記為 untrusted；完整 secret/HTML content sanitizer 尚未完成。
- Debug trace 對 Developer/Viewer 分權，預設遮罩 PII/credential；分享/嵌入視圖使用最少資料投影。
- 可疑 injection 不應簡單靠關鍵字封鎖；以最小工具權限、隔離 context、approval 與 egress control 降低影響。

## Rate、資源與濫用

應用目前對公開 auth/invitation route 提供 Redis 分散式節流，並對 Agent runtime 提供 workspace rate/concurrency、Provider timeout/retry、JSON/SSE response byte cap 與 budget 檢查；工具只對 GET/HEAD 重試。其他管理 route 的 limiter、active SSE cap、atomic cost reservation及 upload streaming quota 仍需在 ingress/API 補齊。

Rate key 必須包含 tenant/user/token/route，並避免把攻擊者控制的高基數值直接變成 metric labels。429 回應不洩漏另一租戶配額。

## Audit、保留與刪除

寫入管理 route 會以 interceptor best-effort 寫 AuditLog，API key actor 以 key ID metadata 表示而不冒充建立者。寫入目前不是 transactional outbox，失敗會被吞掉；正式合規部署需 durable queue/outbox、審計讀取事件與 append-only/WORM 集中 sink。

目前每日 job 只按 `Conversation.updatedAt` 刪除 conversation cascade，是 retention baseline，不是完整資料治理。仍需涵蓋 standalone run/tool payload/S3/vector/cache/analytics/backups、活躍對話時間、legal hold、可追蹤 batch 與 idempotent retry。

## Secret 輪替設計（尚未自動化）

- JWT access secret：短暫支援 current/previous kid，等最長 token TTL 後移除舊 key。
- Refresh secret/pepper：輪替通常使所有 refresh sessions 失效，需事先通知並強制重新登入。
- AES key：新寫入用新 version，背景逐筆 decrypt old/encrypt new，驗證完成後才撤銷舊 key。
- Provider key：更新 connection 密文、驗證成功、審計；舊 key 在供應商端撤銷。

任何輪替工具不得把 plaintext key 輸出到 stdout、shell history 或 migration table。

## 安全驗證清單

- 跨租戶 UUID、不同角色與 revoked membership/API key 測試。
- SSRF IPv4/IPv6、redirect、DNS rebinding、metadata endpoint 測試。
- log/error/trace/usage/audit 中的 canary secret 掃描。
- refresh replay、CSRF、token expiry/revocation、bootstrap race 測試。
- prompt injection → tool call、approval tampering、schema bypass 測試。
- dependency/container/IaC scan、DAST、backup restore 與 incident response 演練。

# 架構決策記錄

本文件採簡化 ADR 格式。狀態為「Accepted」的決策是目前實作約束；變更時應新增決策，不直接抹除背景與取捨。

## ADR-001：pnpm monorepo 與 modular monolith

**狀態：** Accepted

**決策：** Next.js、NestJS 與 shared package 放在同一 pnpm workspace；API 先以 modular monolith 部署。

**理由：** 共用 TypeScript 契約與單一變更集可降低跨服務漂移。平台早期的身份、租戶、版本發布及計費具有強交易關係，拆成微服務會增加分散式一致性與營運負擔。

**後果：** 模組不得直接穿透彼此 repository；高負載 runtime/ingestion 可經 BullMQ port 後續拆出 worker。單體不是把所有邏輯放入單一 service 的理由。

## ADR-002：Provider 採 port/adapter

**狀態：** Accepted

**決策：** Agent runtime 只依賴統一 ProviderAdapter。供應商 payload、SDK error、usage 與 capabilities 留在 adapter。

**理由：** 模型能力與串流/tool/structured-output 語意不同，依 provider name 寫條件分支會快速污染業務層。

**後果：** 每個 adapter 必須實作 credential validation、model discovery、chat/stream、usage/error normalization 與能力檢測；不支援的能力回傳明確 capability error，不做靜默降級。

## ADR-003：Organization + Workspace 雙層租戶

**狀態：** Accepted

**決策：** Organization 是 membership/RBAC 邊界；Workspace 是 Provider、Agent、Tool、Usage 與 budget 邊界。client 以兩個 header 選擇 context，server 重新驗證關聯。

**理由：** 企業通常共享成員管理，同時需要依部門/環境隔離 Agent 與成本。

**後果：** 所有 workspace query 必須帶 workspaceId；cache/queue/object keys 同樣包含 tenant ID。header 本身不授權。

## ADR-004：短效 JWT + rotating refresh session

**狀態：** Accepted

**決策：** access token 短效；refresh token 以 HttpOnly cookie 傳遞並只存 hash/session metadata，可逐一撤銷與輪替。

**理由：** 純長效 JWT 無法有效撤銷；完整 server session 又增加所有 API request 的 session lookup。混合方式平衡延遲與控制。

**後果：** refresh/logout 是 CSRF 敏感端點，需 SameSite/Origin control；XSS 仍可能利用當前 access token，前端不得把 token 寫入 URL 或日誌。

## ADR-005：AES-256-GCM envelope-ready credential storage

**狀態：** Accepted

**決策：** Provider credential 以每筆隨機 nonce 的 AES-256-GCM authenticated encryption 保存，主 key 由環境/secret manager 提供。

**理由：** credential 必須可在執行時還原，因此不能只雜湊；GCM 同時提供機密性與完整性。

**後果：** 單一環境 key 輪替需要 re-encryption 流程。大型部署應改為 KMS envelope encryption，DB 只存 wrapped data key 與 ciphertext。

## ADR-006：Agent 發布採 immutable version pointer

**狀態：** Accepted

**決策：** Agent metadata 與 AgentVersion 分離；發布/回滾原子更新 `publishedVersionId`，歷史版本不覆寫。

**理由：** 可重現執行、審計及可靠回滾要求每次 run 精確引用版本。

**後果：** 編輯已發布設定需產生新 draft；刪除 Provider/Tool 時必須尊重歷史版本的 restrict relation。

## ADR-007：SSE 作為文字生成串流協定

**狀態：** Accepted

**決策：** Agent stream 使用 HTTP SSE；只有真正雙向、低延遲協作需求才加入 WebSocket。

**理由：** 模型 token 流主要是 server-to-client，SSE 更容易穿越企業 proxy、觀測與重連。

**後果：** proxy buffering 必須關閉，需處理 client disconnect/cancellation；非冪等 POST stream 不自動用瀏覽器 EventSource 重放。

## ADR-008：生產環境使用外部 stateful services

**狀態：** Accepted

**決策：** Compose 內建 PostgreSQL/Redis/MinIO 供本地開發；Kubernetes baseline 只部署無狀態 API/Web，連接受管資料服務。

**理由：** 自行營運資料庫需要備援、備份、升級及故障切換能力，不能由簡單 Deployment/StatefulSet 範例代表生產品質。

**後果：** 部署者需提供 TLS endpoints、備份/restore、監控及容量管理；migration 由獨立 Job 先執行。

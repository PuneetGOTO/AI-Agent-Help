# 實作計劃與驗收矩陣

此計劃按依賴順序交付可垂直驗證的功能，避免先做無後端契約的靜態頁面。狀態以 repository 當前基線為準；更細的缺口見 [已知限制](unfinished.md)。

| 階段                    | 交付                                                                                        | 驗證                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1. 基礎                 | pnpm workspace、環境驗證、Compose/Kubernetes、health                                        | Compose/Kustomize parse、health smoke                    |
| 2. 資料                 | Prisma tenant/RBAC/provider/agent/run/usage/audit schema、migration、seed                   | `prisma generate/validate/deploy`、seed idempotency      |
| 3. 身份與租戶           | bootstrap/login/refresh/logout、Owner/Admin/Developer/Operator/Viewer、tenant/RBAC guards   | auth unit + anonymous/foreign workspace E2E              |
| 4. Provider             | AES-GCM credential、七類真實 adapter、capability/error/usage normalize                      | adapter contract tests + write-only credential E2E       |
| 5. Agent runtime        | Agent/version/publish/rollback/duplicate、conversation/run、chat/SSE                        | lifecycle integration + gated real-provider stream       |
| 6. Tools/RAG            | schema/policy/approval/trace、S3 document/ingestion/retrieval                               | SSRF/tool policy + RAG tenant isolation tests            |
| 7. Enterprise telemetry | Usage/cost/budget/rate/concurrency/audit/retention                                          | aggregation, limit, audit redaction, deletion tests      |
| 8. 管理介面             | Auth、Dashboard、Agents/Playground、Providers、Tools/KB、Usage、Members/Keys/Audit/Settings | loading/empty/error/unauthorized + responsive Playwright |
| 9. Release              | lint、typecheck、unit/integration/E2E、build、migration、image/Compose/K8s                  | CI required checks、restore/rollback/security review     |

目前 repository baseline 已完成階段 1-9 的可運行路徑與自動化 smoke；未涵蓋的供應商、進階 RAG、長期記憶與企業 IdP 等範圍明確列於 [已知限制](unfinished.md)，不視為隱含完成。

## Definition of done

每個功能需同時具備 tenant predicate、permission、DTO/OpenAPI、錯誤/空白/載入 UI（若適用）、audit/usage（若適用）、自動化測試、文件與營運手冊。只有按鈕、固定資料、未接線的 route 或未驗證的 Provider capability 不算完成。

## 風險優先級

1. P0：跨租戶存取、credential 洩漏、任意工具/SSRF、migration/backup 不可恢復。
2. P1：錯誤成本/預算、重複工具副作用、stream 取消/資源耗盡、審計缺口。
3. P2：Provider 邊緣相容、進階分析、操作效率與視覺 polish。

正式生產上線前，`unfinished.md` 中與目標部署相關的 P0/P1 項目必須關閉或有書面風險接受與補償控制。

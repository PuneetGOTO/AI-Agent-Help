# API 指南

互動式文件位於 `/docs`，OpenAPI JSON 位於 `/docs-json`。所有業務路由使用 `/api/v1` prefix。

## 認證與租戶 context

| Method | Path                     | 用途                                                                               |
| ------ | ------------------------ | ---------------------------------------------------------------------------------- |
| GET    | `/auth/bootstrap/status` | 是否已有第一位管理員                                                               |
| POST   | `/auth/bootstrap`        | 僅空系統可建立首位 Owner/Organization/Workspace；production 需 `X-Bootstrap-Token` |
| POST   | `/auth/login`            | 取得 access token 與 refresh session                                               |
| POST   | `/auth/refresh`          | 輪替 refresh session                                                               |
| POST   | `/auth/session`          | 瀏覽器安全恢復 session；匿名亦回 200                                               |
| POST   | `/auth/logout`           | 撤銷目前 refresh session                                                           |
| GET    | `/auth/me`               | 使用者、membership 與可用租戶 context                                              |

除公開 auth/health/docs 外，管理請求傳送：

```http
Authorization: Bearer eyJ...
X-Organization-Id: 3b28c46c-...
X-Workspace-Id: c1437df2-...
Content-Type: application/json
```

Organization/Workspace header 必須源自 `/auth/me` 回傳的 membership。缺少 context、角色無權限、資源屬其他租戶時，API 分別回傳 validation/authz/not-found 類型錯誤，且不洩漏另一租戶是否存在。

API key 不能呼叫 `/auth/me` 或 invitation acceptance 等 session-only 路由。Agent key 只可執行綁定且已發布的 Agent，不可使用 debug draft 或延續人類對話；Platform key 只支援 read/run scope，不接受管理寫入權限。

## 主要資源

| Method                | Path                              | 說明                                 |
| --------------------- | --------------------------------- | ------------------------------------ |
| GET/POST              | `/providers`                      | 列出/建立工作區 Provider Connection  |
| POST                  | `/providers/{id}/validate`        | 以後端密文驗證 credential            |
| GET                   | `/providers/{id}/models`          | 透過 adapter 列出模型與 capabilities |
| GET/POST              | `/agents`                         | 列出/建立 Agent                      |
| GET/PATCH/DELETE      | `/agents/{id}`                    | 工作區範圍讀取/修改/soft delete      |
| GET/POST              | `/agents/{id}/versions`           | 版本列表/建立 draft version          |
| POST                  | `/agents/{id}/publish`            | 發布指定 draft version               |
| POST                  | `/agents/{id}/rollback`           | 把 published pointer 回滾至既有版本  |
| POST                  | `/agents/{id}/duplicate`          | 在目前工作區複製 Agent               |
| POST                  | `/agents/{id}/chat`               | 非串流執行                           |
| POST                  | `/agents/{id}/chat/stream`        | SSE 串流執行                         |
| GET/POST              | `/workspaces`                     | 可用工作區與建立工作區               |
| GET/PATCH             | `/settings/workspace`             | 工作區預算、速率、保留與工具政策     |
| GET/PATCH/DELETE      | `/members`, `/members/{id}`       | 成員與 membership                    |
| GET/POST/PATCH/DELETE | `/roles`, `/roles/{id}`           | 預設/自訂角色與 permission           |
| GET/POST/DELETE       | `/invitations`                    | 邀請建立、撤銷與 token acceptance    |
| GET/POST/DELETE       | `/api-keys`                       | workspace/Agent API token            |
| GET/POST/DELETE       | `/knowledge-bases`                | 知識庫與 tenant-scoped 刪除          |
| POST/DELETE           | `/knowledge-bases/{id}/documents` | 文字文件 ingestion 與物件刪除        |
| POST                  | `/tool-executions/{id}/approve`   | 執行高風險工具                       |
| POST                  | `/tool-executions/{id}/reject`    | 拒絕高風險工具                       |
| GET                   | `/usage/summary`                  | 工作區 token/cost/latency 摘要       |
| GET                   | `/audit-logs`                     | Organization/Workspace 審計記錄      |
| GET                   | `/health`                         | 健康檢查                             |

請以當前 OpenAPI schema 為 request/response DTO 的唯一契約；本表只列穩定資源語意。

## SSE

範例請求：

```bash
curl --no-buffer \
  -X POST "http://localhost:4000/api/v1/agents/AGENT_ID/chat/stream" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "X-Organization-Id: ORGANIZATION_ID" \
  -H "X-Workspace-Id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"message":"Summarize the incident report"}'
```

Consumer 應按 `event` 類型處理 delta、tool/trace、usage、done 與 error，而非假設每個 `data` 都是純文字。任何事件 payload 仍是 JSON；client 要限制累積大小並對輸出做 context-aware encoding。POST stream 不應在連線中斷後盲目重送，除非附帶服務端支援的 idempotency key。

## 錯誤與追蹤

錯誤回應包含穩定 HTTP status、message/code 與 `X-Request-Id`，不得包含 stack、API key、Authorization、cookie、完整 prompt 或 Provider 原始敏感 response。向支援團隊提供 request ID、時間、workspace 與 run ID 即可。

常見 status：

| Status  | 語意                                   |
| ------- | -------------------------------------- |
| 400     | DTO/schema/context 不合法              |
| 401     | token 缺少、失效或 session 撤銷        |
| 403     | membership/RBAC/capability/policy 拒絕 |
| 404     | 資源不存在或不屬目前租戶               |
| 409     | slug/version/bootstrap 等狀態衝突      |
| 429     | workspace rate/concurrency/budget 限制 |
| 502/504 | Provider 正規化錯誤或 timeout          |

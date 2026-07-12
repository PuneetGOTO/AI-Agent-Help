# Provider 擴展指南

## 契約

每個 AI 供應商透過統一 adapter 接入，至少涵蓋：

```ts
interface ProviderAdapter {
  validateCredential(input: CredentialContext): Promise<ValidationResult>;
  listModels(input: ModelListContext): Promise<NormalizedModel[]>;
  chat(input: ChatRequest): Promise<ChatResult>;
  streamChat(input: ChatRequest): AsyncIterable<StreamEvent>;
  embeddings(input: EmbeddingRequest): Promise<EmbeddingResult>;
  toolCalling(input: ToolCallingRequest): Promise<ToolCallingResult>;
  structuredOutput(input: StructuredOutputRequest): Promise<StructuredOutputResult>;
  normalizeUsage(raw: unknown): NormalizedUsage;
  normalizeError(error: unknown): NormalizedProviderError;
  capabilityDetection(model: string): Promise<ModelCapabilities>;
}
```

實際型別與 method signature 以 `apps/api/src/modules/providers` 中的 port 為準。Agent/runtime service 只使用正規化型別，不得 import 供應商 SDK、檢查 ProviderType 後自行組 payload，或假設每個模型支援 tool/JSON/vision/embeddings。

目前實作矩陣：

| Provider                             | Transport                  | 明確能力邊界                                                                                                                  |
| ------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| OpenAI / Azure / Compatible / Ollama | OpenAI-style fetch adapter | 依模型檢測 tools/JSON/vision；Ollama 私網只由部署 allowlist 開放                                                              |
| Anthropic                            | 官方 `@anthropic-ai/sdk`   | chat/stream/tools/structured output；不宣告 embeddings                                                                        |
| Google Gemini                        | 官方 `@google/genai`       | chat/stream/tools/structured output/embeddings；Developer API key 或 Vertex ADC；自訂 endpoint 限 Google 官方 hostname        |
| AWS Bedrock                          | 官方 control/runtime SDK   | Converse/stream/tools；Titan/Cohere embeddings；模型級 structured output；endpoint 限同 region 官方 hostname 或部署 allowlist |

## 新增步驟

1. 在 shared/Prisma ProviderType 加入識別值並建立 migration（若不能使用既有 `OPENAI_COMPATIBLE`）。
2. 建立 adapter，注入經解密但生命週期受限的 credential context、base URL 與 provider config。
3. 在 adapter registry 註冊 factory；registry 應 fail closed，未知類型回傳 unsupported provider。
4. 實作 credential validation，採低成本端點與短 timeout；錯誤只回分類，不回顯 secret/header/raw body。
5. 將模型清單轉成穩定 model ID/display name/capabilities，並處理 pagination。
6. 實作非串流與串流 mapping；stream parser 必須處理分段 UTF-8、finish reason、usage-only chunk、client cancellation。
7. 分別實作 embeddings、tool calling 與 structured output。供應商不支援時回 `supported: false`/typed error，不使用有損 prompt 模擬而不告知呼叫者。
8. 正規化 usage、rate-limit/timeout/auth/safety/content-length/error；保留可安全觀測的 provider request ID。
9. 加入 unit contract tests、HTTP mocked integration tests，以及 gated real-provider canary。
10. 更新 capability/cost metadata、OpenAPI enum、UI 選項、文件與安全 egress allowlist。

## Capability 原則

Capabilities 是「provider + model + endpoint/version」的函數，不只是 ProviderType 常數。Azure deployment、Bedrock model ID、Gemini API version 與 OpenAI-compatible server 都可能改變功能。可 cache discovery 結果，但要有 TTL/refresh；使用者選擇不相容設定時，在發布前明確拒絕。

建議的 normalized capability：

- chat、streaming、embeddings
- tools、parallelTools、toolChoice
- jsonMode、jsonSchema
- vision/audio（若平台開放）
- maxInputTokens、maxOutputTokens
- supportsUsageInStream

不要以模型名稱 substring 作唯一判斷。若供應商沒有 discovery API，使用經版本化的 allowlist metadata，並允許管理員重新同步。

## Credential 與 Base URL

- API key/secret/token 只存在 request DTO → encryption service → 暫時 adapter context；禁止進 URL、log、trace、queue payload 或 client response。
- 客製 base URL 需強制 `https`（本機 Ollama 可由明確 policy 例外）、移除 userinfo/fragment、限制 port，並做 DNS resolve 後的 private/link-local/metadata IP 防護。
- Redirect 必須重新驗證目的地，或直接禁止；不得把 Authorization 轉發到不同 origin。
- AWS Bedrock 使用 scoped IAM/temporary credential；custom proxy 只能由部署端 `BEDROCK_ALLOWED_ENDPOINTS` 精確批准。Gemini Vertex 使用 workload ADC，租戶不提交 service-account JSON。Azure 使用 endpoint/deployment/API version 的結構化 config，不把它們拼成任意 URL。

## Error 正規化

Normalized error 至少包含：

| 欄位                | 說明                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `code`              | `AUTHENTICATION`、`RATE_LIMITED`、`TIMEOUT`、`UNSUPPORTED_CAPABILITY`、`SAFETY_BLOCKED`、`UPSTREAM` |
| `retryable`         | runtime 是否可以依 policy 重試                                                                      |
| `status`            | 對外穩定 HTTP status，不原樣信任 upstream                                                           |
| `providerRequestId` | 可安全傳給支援的 request ID                                                                         |
| `retryAfterMs`      | 經上下界限制的 retry hint                                                                           |

Raw error 只能在完成 redaction 且受限制的內部 observability sink 保存。Provider 的 429/5xx 重試採 exponential backoff + jitter，並尊重整體 Agent timeout；401/403、schema/safety 錯誤一般不可重試。

## 測試矩陣

每個 adapter 必測：有效/無效 credential、models pagination、非串流、stream chunk 邊界、usage 缺失、tool args 不合法、structured schema 拒絕、429 retry-after、5xx、timeout、abort、redaction、unsupported capability。Real canary 只由 CI secret context 觸發，不在 fork PR 執行，並使用極低 token/cost budget。

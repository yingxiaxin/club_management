# P0 API 契约（管理端）

本地实现：`cloud/dev-server`（默认 `http://127.0.0.1:3789`）  
云函数：`cloud/functions/adminApi`（`action=listMembers|createMember|...|importMembers`，见 `docs/云数据库接入.md`）  
成员存储：`DATA_BACKEND=json|cloud`（cloud 时读写集合 `members`）

除登录与 health 外，请求头需：`Authorization: Bearer <token>`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | body: `{ username, password }` 应急账号 |
| POST | `/api/auth/qr/start` | 创建扫码票 + 小程序码（需云密钥与已部署 adminApi） |
| GET | `/api/auth/qr/:ticketId` | 轮询；`confirmed` 时签发 Bearer token 并消费票 |
| GET | `/api/auth/me` | 当前管理员 |
| GET | `/api/members` | query: sort/order/pathway/title/q |
| GET | `/api/members/export.csv` | CSV 导出 |
| GET | `/api/members/:id` | 详情 |
| POST | `/api/members` | 创建 |
| PUT | `/api/members/:id` | 更新 |
| DELETE | `/api/members/:id` | 软删（status=left） |
| POST | `/api/members/batch-scores` | body: `{ items: [{ id, powerScore?, fashionScore? }] }` |
| POST | `/api/ocr/parse` | multipart `images`（可多张）→ 识别预览，**不写库** |
| GET | `/api/ocr/jobs/:id` | 识别任务详情 |
| POST | `/api/ocr/commit` | body: `{ jobId, rows[] }` 确认后按角色名新增/更新 |

### OCR 约定

- `parse` 返回 `{ jobId, candidates, rawText?, tip? }`；`candidates` 含 `selected / action(create|update) / lowConfidence` 等，供预览表编辑。
- `commit` 仅处理 `selected !== false` 的行；匹配键为 **角色名**；新建成员 `status=active`，并写 `lastOcrJobId`。
- 成员字段含可选 `level`（等级）；OCR 预览与 CSV 导出一并带出。
- 本地引擎：优先 RapidOCR（Python `rapidocr_onnxruntime` + 坐标版面解析），否则 Tesseract（`chi_sim`）。可选腾讯云。返回 `provider` / `tip` 供前端提示。**必须人工确认**后再 commit。

统一响应：`{ ok: boolean, data?: any, message?: string }`

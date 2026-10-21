# P0 API 契约（管理端）

本地实现：`cloud/dev-server`（默认 `http://127.0.0.1:3789`）  
云函数占位：`cloud/functions/adminApi`（稍后接云库）

除登录与 health 外，请求头需：`Authorization: Bearer <token>`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | body: `{ username, password }` |
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
- 本地 OCR 使用 Tesseract（`chi_sim`）；首次运行会下载语言包到用户缓存目录。游戏头像旁角色名易缺字，**必须人工确认**。

统一响应：`{ ok: boolean, data?: any, message?: string }`

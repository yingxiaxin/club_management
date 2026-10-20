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
| GET | `/api/members/:id` | 详情 |
| POST | `/api/members` | 创建 |
| PUT | `/api/members/:id` | 更新 |
| DELETE | `/api/members/:id` | 软删（status=left） |
| POST | `/api/members/batch-scores` | body: `{ items: [{ id, powerScore?, fashionScore? }] }` |
| GET | `/api/members/export.csv` | CSV 导出 |

统一响应：`{ ok: boolean, data?: any, message?: string }`

# API 契约（P0 + P1-a/b）

本地实现：`cloud/dev-server`（默认 `http://127.0.0.1:3789`）  
云函数：`cloud/functions/adminApi`（`action=listMembers|createMember|...|importMembers`，见 `docs/云数据库接入.md`）  
成员端云函数：`cloud/functions/memberApi`（小程序 `wx.cloud.callFunction`）  
成员 / 活动存储：`DATA_BACKEND=cloud` 时走云库（`members`、`activities` 等）

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
| DELETE | `/api/members/:id` | 软删（status=left）并解除微信关联（清空 boundOpenid / users.memberId） |
| POST | `/api/members/batch-scores` | body: `{ items: [{ id, powerScore?, fashionScore? }] }` |
| POST | `/api/ocr/parse` | multipart `images`（可多张）→ 识别预览，**不写库** |
| GET | `/api/ocr/jobs/:id` | 识别任务详情 |
| POST | `/api/ocr/commit` | body: `{ jobId, rows[] }` 确认后按角色名新增/更新 |
| GET | `/api/invites` | 邀请码列表（需云库） |
| POST | `/api/invites` | 创建邀请码 |
| PATCH | `/api/invites/:id` | 更新启用/次数/过期 |
| GET | `/api/join-applications` | query: `status`；入会申请 |
| POST | `/api/join-applications/:id/review` | body: `{ decision: approved\|rejected }` |
| GET | `/api/club-profile` | 俱乐部资料 / 默认提醒 / 订阅模板 |
| PUT | `/api/club-profile` | 更新；body 可含 `name` / `iconUrl` / `intro` / `reminderOffsetsMinutes` / `subscribeTemplateId` / `subscribeMiniprogramState`；响应含 `iconDisplayUrl`（预览） |
| POST | `/api/club-profile/icon` | multipart `file`：上传图标到云存储并写入 `iconUrl`；≤10MB，PNG/JPG/WebP/GIF |
| GET | `/api/announcements` | P1-e：公告列表（置顶优先） |
| POST | `/api/announcements` | 创建；body: `title` / `content` / `pinned?` / `publishedAt?` |
| PUT | `/api/announcements/:id` | 更新 |
| DELETE | `/api/announcements/:id` | 删除 |
| GET | `/api/activities` | query: status/from/to/q |
| GET | `/api/activities/:id` | 详情 |
| GET | `/api/activities/:id/rsvps/occurrences` | 可导出场次：`{ options:[{ dateKey, label, source: live\|snapshot, rowCount }] }` |
| GET | `/api/activities/:id/rsvps/export.csv` | query `dateKey` 缺省/`live`=本场；否则快照日 `YYYY-MM-DD`；CSV 列见 `docs/P1-c出席意向RSVP.md` |
| POST | `/api/activities` | 创建；body 含 `startSchedule` / `endSchedule?` / `reminderCycle`；status: draft\|published；`reminderOffsetsMinutes` 可忽略（服务端存空，提前量跟俱乐部） |
| PUT | `/api/activities/:id` | 更新（cancelled/ended 不可改） |
| POST | `/api/activities/:id/transition` | body: `{ action: publish\|cancel\|start\|end }` |

日程分量 `*Schedule`：`{ year, month, day, weekday(1–7), time:"HH:mm" }`（均可 null）。开始至少一项非空。`reminderCycle`：管理端「开启提醒」关→`none`；开则无 time→`none`，有完整年月日→`once`，有 weekday→`weekly`，有 day→`daily`，仅 time→`daily`。提前量一律 `club_profile.reminderOffsetsMinutes`。

### 成员端云函数 `memberApi`（P0-e + P1-b）

调用：`{ action, ... }` → `{ ok, data?, message?, status? }`。须微信登录（`OPENID`）。查看类 action 需已绑定成员或管理员（同 `canViewMembers`）。

| action | 说明 |
|--------|------|
| `health` / `whoami` | 健康检查 / 当前身份 |
| `bindByCharacterName` / `submitJoinApplication` / `getMyJoinApplication` / `unbindSelfForTest` | 入会关联（P0-e） |
| `listMembers` / `getMember` | 成员只读 |
| `listSchedule` | P1-b/c：`{ today[], week[], meta }`；条目含 `rsvpCounts`；仅 `published`/`ongoing` |
| `getActivity` | 详情 + RSVP + `subscribeTemplateId` / `myReminderSubscribed` / `canSubscribeReminder` |
| `getReminderConfig` | P1-d：俱乐部默认提前量与模板 ID |
| `getClubProfile` | P1-e：`{ name, iconUrl, intro }`；未绑定也可调 |
| `listAnnouncements` | P1-e：公告列表（须可查看成员）；可选 `limit` |
| `subscribeActivityReminder` | P1-d：body `id` + `accepted`；写入 `subscriptions` |
| `setRsvp` | P1-c：body `id` + `status(going\|maybe\|decline)`；须绑定成员；开始后可改、本场结束后锁定；周期换场清 RSVP；返回更新后的详情 |

定时云函数 `reminderDispatch`：每分钟扫描到期提醒并 `subscribeMessage.send`（见 `docs/P1-d提醒与订阅消息.md`）。

定时云函数 `teamLifecycle`：每分钟调用 `memberApi.expireTeamsDue`，将 `startAt` 已到的 `recruiting`/`full`/`paused` 队伍标为 `started`（见 `docs/P2组队.md` P2-d）。本机联调可 `POST /api/teams/expire-due`（需 admin）。

日程匹配冒烟（不连库）：`node cloud/dev-server/scripts/smoke-p1b-schedule.mjs`

### OCR 约定

- `parse` 返回 `{ jobId, candidates, rawText?, tip? }`；`candidates` 含 `selected / action(create|update) / lowConfidence` 等，供预览表编辑。
- `commit` 仅处理 `selected !== false` 的行；匹配键为 **角色名**；新建成员 `status=active`，并写 `lastOcrJobId`。
- 成员字段含可选 `level`（等级）；OCR 预览与 CSV 导出一并带出。
- 本地引擎：优先 RapidOCR（Python `rapidocr_onnxruntime` + 坐标版面解析），否则 Tesseract（`chi_sim`）。可选腾讯云。返回 `provider` / `tip` 供前端提示。**必须人工确认**后再 commit。

统一响应：`{ ok: boolean, data?: any, message?: string }`

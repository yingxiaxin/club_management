# 诡秘之主 · 俱乐部管理

单俱乐部运营工具：成员花名册（非凡评分等）、今日/本周活动与提醒、副本/PVP 组队招募；成员端为微信小程序，管理员使用独立 PC Web 后台。

## 仓库结构

```
俱乐部管理/
├── docs/           # 产品与技术方案文档
├── miniprogram/    # 微信小程序（成员端）
├── admin/          # PC 管理后台（Web）
├── cloud/          # 后端：微信云开发（云函数、数据库规则、定时触发等）
└── README.md
```

各工程职责与本地启动说明见对应目录下的 `README.md`。

## 文档索引

| 文档 | 说明 |
|------|------|
| [AGENTS.md](AGENTS.md) | **跨电脑 / 跨 Agent 必读**：共识入口与铁律 |
| [docs/进度与交接.md](docs/进度与交接.md) | **当前进度与下一步**（每会话收工更新） |
| [docs/功能说明书.md](docs/功能说明书.md) | 功能范围、角色权限、页面与状态机（已定稿） |
| [docs/开发阶段规划.md](docs/开发阶段规划.md) | P0～P3 分期与验收标准 |
| [docs/数据模型草案.md](docs/数据模型草案.md) | 云数据库集合与字段草案 |

## 跨机器持续开发

1. 本仓库已托管于 GitHub：`git@github.com:yingxiaxin/club_management.git`
2. 其他电脑：`git clone` 或 `git pull` 后用 Cursor 打开本仓库
3. 项目规则在 `.cursor/rules/`，会随仓库生效
4. 新 Agent 会话先读 `AGENTS.md` → `docs/进度与交接.md`
5. **不要依赖聊天历史**；稳定结论写入 `docs/`，临时状态写入进度文件

## 技术选型（摘要）

- 成员端：微信小程序原生
- 管理端：Vue 3 + Element Plus（独立 Web）
- 后端：微信云开发（CloudBase）云函数 + 云数据库
- 提醒：微信订阅消息 + 云开发定时触发；提醒提前量由管理员配置

## 当前进度（2026-10-20 停工）

- [x] 需求梳理与功能定稿
- [x] P0-a / P0-b：本地 API + PC 管理端成员手录（**用户验收通过**）
- [ ] 云数据库接入（数据仍在本地 JSON，见交接文档）
- [ ] P0-ocr / 扫码 / 小程序 / 邀请码
- [ ] P1～P3（见 `docs/开发阶段规划.md`）

**接续开发请先读：[AGENTS.md](AGENTS.md) → [docs/进度与交接.md](docs/进度与交接.md)**

## 本地快速启动（管理端）

```bash
cd cloud/dev-server && npm install && npm run dev
cd admin && npm install && npm run dev
```

浏览器：http://127.0.0.1:5173 ，账号 `superadmin` / `club-change-me`

## Git / GitHub

远程：`origin` → `git@github.com:yingxiaxin/club_management.git`（分支 `main`）

```bash
git pull
git push
```

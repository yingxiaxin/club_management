# 后端（微信云开发）

承载登录与角色、成员/活动/组队业务、定时提醒与订阅消息发送。数据库集合定义见 `docs/数据模型草案.md`。

## 技术预期

- 微信云开发 CloudBase：云函数、云数据库、定时触发器
- 小程序与 `admin` 共用同一云环境

## 目录

```
cloud/
├── env.json               # AppID + 云环境 ID
├── api-contract.md        # 管理端 API 契约
├── dev-server/            # 本地 API（admin 联调；可切云库）
├── functions/adminApi/    # 管理端云函数（members 写 + 扫码登录）
├── functions/memberApi/   # 成员端云函数（绑定 + 列表只读）
└── README.md
```

## 环境配置

| 文件 | 说明 |
|------|------|
| `env.json` | AppID + 云环境 ID（已入库） |
| `dev-server/.env` | 本地密钥（gitignore；见 `.env.example`） |

当前：`appId=wx0a3fc7a2aee9f66f`，`envId=cloud1-d6gjqx2kd2f3765f4`。

## 成员数据源

| `DATA_BACKEND` | 行为 |
|----------------|------|
| `json`（默认） | `dev-server/data/members.json` |
| `cloud` | 云数据库 `members`（需 `CLOUDBASE_SECRET_ID/KEY`） |

接入步骤详见 **`docs/云数据库接入.md`**。

## P0 联调

1. 跑 `dev-server`（见 `dev-server/README.md`）
2. 跑 `admin` 前端
3. 导入成员：`npm run prepare:cloud-import` 后控制台导入，或配密钥 `npm run import:cloud-members`
4. 云函数：开发者工具上传 `functions/adminApi`；成员端再上传 `functions/memberApi`（见 `docs/P0-d成员端.md`）

## 原则

- 写操作与权限校验放在服务端（本地 API / 云函数）
- 密钥勿提交；应急密码仅用于开发，上线前必须更换

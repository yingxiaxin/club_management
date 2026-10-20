# 后端（微信云开发）

承载登录与角色、成员/活动/组队业务、定时提醒与订阅消息发送。数据库集合定义见 `docs/数据模型草案.md`。

## 技术预期

- 微信云开发 CloudBase：云函数、云数据库、定时触发器
- 小程序与 `admin` 共用同一云环境

## 目录

```
cloud/
├── env.json             # AppID + 云环境 ID
├── api-contract.md      # 管理端 API 契约
├── dev-server/          # P0 本地 API（admin 默认联调）
├── functions/adminApi/  # 微信云函数占位（后续接云库）
└── README.md
```

## 环境配置

| 文件 | 说明 |
|------|------|
| `env.json` | AppID + 云环境 ID（已入库） |
| `appid.local.json.example` | 本地覆盖模板（可选） |

当前：`appId=wx0a3fc7a2aee9f66f`，`envId=cloud1-d6gjqx2kd2f3765f4`。

## P0 联调方式

1. 跑 `dev-server`（见 `dev-server/README.md`）
2. 跑 `admin` 前端
3. 云函数 `functions/adminApi` 待接入云数据库后再切换；接口形状以 `api-contract.md` 为准

## 原则

- 写操作与权限校验放在服务端（本地 API / 云函数）
- 密钥勿提交；应急密码仅用于开发，上线前必须更换

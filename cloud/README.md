# 后端（微信云开发）

承载登录与角色、成员/活动/组队业务、定时提醒与订阅消息发送。数据库集合定义见 `docs/数据模型草案.md`。

## 技术预期

- 微信云开发 CloudBase：云函数、云数据库、定时触发器
- 小程序与 `admin` 共用同一云环境

## 目录约定（实现后）

```
cloud/
├── functions/           # 云函数
│   ├── login/
│   ├── member/
│   ├── activity/
│   ├── team/
│   └── reminder/
├── database/            # 可选：初始化规则、索引说明
└── cloudbaserc.json     # 环境配置（勿提交含密钥的本地覆盖文件）
```

## 原则

- 写操作与权限校验放在云函数，避免客户端直写敏感字段
- 订阅消息发送由定时触发器扫描待提醒任务
- 密钥、环境 ID 私密配置走本地文件 + `.gitignore`

## 环境配置

| 文件 | 说明 |
|------|------|
| `env.json` | AppID + 云环境 ID（已入库） |
| `appid.local.json.example` | 仅作本地覆盖模板（可选，已 gitignore） |

当前：`appId=wx0a3fc7a2aee9f66f`，`envId=cloud1-d6gjqx2kd2f3765f4`。

> P0 业务编码尚未开始；骨架初始化待用户确认「开始 P0」。

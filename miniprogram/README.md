# 微信小程序（成员端）

面向俱乐部成员：成员列表、活动日程与 RSVP、订阅提醒、组队招募。

## 技术预期

- 微信小程序原生（WXML / WXSS / JS 或 TS）
- 对接本仓库 `cloud/` 云开发环境（同一 AppID / 云环境）

## 目录约定（实现后）

```
miniprogram/
├── pages/          # 页面
├── components/     # 组件
├── services/       # 调用云函数 / 业务 API
├── utils/
├── app.js / app.json / app.wxss
└── project.config.json
```

## 本地开发

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. **导入仓库根目录** `俱乐部管理/`（不是本 `miniprogram/` 子目录）
3. AppID / 云环境与 `cloud/env.json` 一致

云函数在左侧文件树 `cloud/functions/` 下右键部署，见 `docs/云数据库接入.md`。

## 当前配置

- AppID：`wx0a3fc7a2aee9f66f`（仓库根 `project.config.json`）
- 云环境：`cloud1-d6gjqx2kd2f3765f4`
- 已有占位首页；成员端业务页在 **P0-d** 再做

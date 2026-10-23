# PC 管理后台（Web）

Vue 3 + Vite + Element Plus。样式主题在 `src/styles/tokens.css`（暗色+古铜金，对齐游戏截图），换肤优先改该文件；色板说明见 `docs/视觉风格指南.md`。

## 本地运行

先启动 API，再启动本前端：

```bash
# 终端 1
cd cloud/dev-server
npm install
npm run dev

# 终端 2
cd admin
npm install
npm run dev
```

浏览器打开：http://127.0.0.1:5173  

应急账号配置在本机 `cloud/dev-server/.env` 的 `EMERGENCY_*`（见 `.env.example`）；**不要**写进页面或公开文档，建议同步记在密码管理器。日常请用微信扫码。

> 建议 Node **18+**。若为 Node 16，本仓库已锁定 Vite 4 以便运行。

## 当前能力

- 应急账号登录
- 成员手动增删改查、筛选排序、导出 CSV
- **从截图导入**（P0-ocr）：选择 / 拖拽 / `Ctrl+V` 粘贴截图（粘贴后自动识别）→ 预览确认 → 按角色名新增或更新
- Design Tokens 主题抽离

## 尚未做

- 微信扫码登录（P0-c）
- 接微信云数据库（当前走本地 `cloud/dev-server`）
- 小程序（P0-d）

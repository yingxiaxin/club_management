# PC 管理后台（Web）

Vue 3 + Vite + Element Plus。样式主题在 `src/styles/tokens.css`（暗色+古铜金，对齐游戏截图），换肤优先改该文件；色板说明见 `docs/视觉风格指南.md`。

## 本地运行（P0-b）

先启动 API（P0-a），再启动本前端：

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

应急账号：`superadmin` / `club-change-me`（或 `admin` / `club-change-me`）

> 建议 Node **18+**。若为 Node 16，本仓库已锁定 Vite 4 以便运行。

## 当前能力

- 应急账号登录
- 成员手动增删改查、筛选排序、导出 CSV
- Design Tokens 主题抽离

## 尚未做

- 微信扫码登录（P0-c）
- 截图 OCR 导入（P0-ocr）
- 接微信云数据库（当前走本地 `cloud/dev-server`）

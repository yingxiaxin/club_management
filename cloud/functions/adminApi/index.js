/**
 * 微信云开发云函数骨架（P0-a）
 * 与本地 cloud/dev-server 的 /api/* 语义对齐；部署后由管理端切换数据源。
 *
 * 当前仓库默认联调走本地 dev-server。上线前在此接入 wx-server-sdk + 云数据库。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { action } = event || {}
  return {
    ok: false,
    message:
      'adminApi 云函数尚未接入云数据库。P0 请使用 cloud/dev-server 本地 API；接入步骤见 cloud/README.md',
    action: action || null,
  }
}

/**
 * 管理端云函数：成员读写走云数据库 members。
 * 调用：cloud.callFunction({ name: 'adminApi', data: { action, ... } })
 *
 * 本地 admin 默认仍走 cloud/dev-server；配置 DATA_BACKEND=cloud 后由 Node SDK 写同一库。
 */
const cloud = require('wx-server-sdk')
const membersDb = require('./membersDb')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function ok(data) {
  return { ok: true, data }
}

function fail(message, status = 400) {
  return { ok: false, message, status }
}

exports.main = async (event) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'health':
        return ok({ service: 'adminApi', store: 'cloud-db', stage: 'cloud-members' })

      case 'listMembers':
        return ok(await membersDb.listMembers(event.query || event))

      case 'getMember': {
        const row = await membersDb.getMember(event.id)
        if (!row || row.status === 'left') return fail('成员不存在', 404)
        return ok(row)
      }

      case 'createMember':
        return ok(await membersDb.createMember(event.body || event.member || {}))

      case 'updateMember':
        return ok(await membersDb.updateMember(event.id, event.body || {}))

      case 'deleteMember':
        return ok(await membersDb.deleteMember(event.id))

      case 'batchUpdateScores':
        return ok(await membersDb.batchUpdateScores(event.items || []))

      case 'upsertMembersByName':
        return ok(
          await membersDb.upsertMembersByName(event.rows || [], {
            ocrJobId: event.ocrJobId,
          }),
        )

      case 'annotateCandidates':
        return ok(await membersDb.annotateCandidates(event.candidates || []))

      case 'importMembers':
        return ok(
          await membersDb.importMembers(event.rows || [], {
            mode: event.mode || 'upsert',
          }),
        )

      default:
        return fail(
          `未知 action: ${action || '(空)'}。支持 health/listMembers/getMember/createMember/updateMember/deleteMember/batchUpdateScores/upsertMembersByName/importMembers`,
          400,
        )
    }
  } catch (e) {
    console.error('[adminApi]', action, e)
    return fail(e.message || '云函数错误', e.status || 500)
  }
}

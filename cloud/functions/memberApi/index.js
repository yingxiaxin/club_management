/**
 * 成员端云函数：登录身份、角色名绑定、成员列表只读。
 * 调用：cloud.callFunction({ name: 'memberApi', data: { action, ... } })
 */
const cloud = require('wx-server-sdk')
const membersDb = require('./membersDb')
const usersDb = require('./usersDb')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function ok(data) {
  return { ok: true, data }
}

function fail(message, status = 400) {
  return { ok: false, message, status }
}

async function requireViewer(openid) {
  const user = await usersDb.ensureUser(openid)
  if (!usersDb.canViewMembers(user)) {
    const e = new Error('请先绑定俱乐部角色后再查看成员列表')
    e.status = 403
    throw e
  }
  return user
}

exports.main = async (event) => {
  const { action } = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    switch (action) {
      case 'health':
        return ok({ service: 'memberApi', store: 'cloud-db', stage: 'P0-d' })

      case 'whoami': {
        if (!openid) return fail('无法获取微信身份', 401)
        const user = await usersDb.ensureUser(openid)
        let member = null
        if (user.memberId) {
          member = await membersDb.getMember(user.memberId)
          if (member && member.status === 'left') member = null
        }
        return ok({
          openid,
          role: user.role,
          displayName: user.displayName || member?.characterName || '',
          memberId: user.memberId,
          member,
          canViewMembers: usersDb.canViewMembers(user),
          isAdmin: usersDb.ADMIN_ROLES.has(user.role),
        })
      }

      case 'bindByCharacterName': {
        if (!openid) return fail('无法获取微信身份', 401)
        const current = await usersDb.ensureUser(openid)
        if (current.memberId && !usersDb.ADMIN_ROLES.has(current.role)) {
          const bound = await membersDb.getMember(current.memberId)
          if (bound && bound.status !== 'left') {
            return ok({
              alreadyBound: true,
              user: current,
              member: bound,
              canViewMembers: true,
            })
          }
        }
        const memberBrief = await membersDb.bindByCharacterName(
          openid,
          event.characterName || event.name,
        )
        const user = await usersDb.attachMember(openid, memberBrief)
        const member = await membersDb.getMember(memberBrief.id)
        return ok({
          alreadyBound: false,
          user,
          member,
          canViewMembers: usersDb.canViewMembers(user),
        })
      }

      case 'listMembers': {
        await requireViewer(openid)
        const list = await membersDb.listMembers(event.query || event)
        return ok(list)
      }

      case 'getMember': {
        await requireViewer(openid)
        const row = await membersDb.getMember(event.id)
        if (!row || row.status === 'left') return fail('成员不存在', 404)
        return ok(row)
      }

      default:
        return fail(
          `未知 action: ${action || '(空)'}。支持 health/whoami/bindByCharacterName/listMembers/getMember`,
          400,
        )
    }
  } catch (e) {
    console.error('[memberApi]', action, e)
    return fail(e.message || '云函数错误', e.status || 500)
  }
}

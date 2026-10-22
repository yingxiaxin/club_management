/**
 * 成员端云函数：登录身份、角色名绑定、入会申请、成员列表只读。
 * 调用：cloud.callFunction({ name: 'memberApi', data: { action, ... } })
 */
const cloud = require('wx-server-sdk')
const membersDb = require('./membersDb')
const usersDb = require('./usersDb')
const invitesDb = require('./invitesDb')

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
    const e = new Error('请先绑定俱乐部角色或完成入会后再查看成员列表')
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
        return ok({ service: 'memberApi', store: 'cloud-db', stage: 'P0-e' })

      case 'whoami': {
        if (!openid) return fail('无法获取微信身份', 401)
        const user = await usersDb.ensureUser(openid)
        let member = null
        if (user.memberId) {
          member = await membersDb.getMember(user.memberId)
          if (member && member.status === 'left') member = null
        }
        // 管理员也可查申请状态（联调）；已绑定 memberId 则不再需要
        const joinApplication = user.memberId
          ? null
          : await invitesDb.getMyApplication(openid)
        return ok({
          openid,
          role: user.role,
          displayName: user.displayName || member?.characterName || '',
          memberId: user.memberId,
          member,
          canViewMembers: usersDb.canViewMembers(user),
          isAdmin: usersDb.ADMIN_ROLES.has(user.role),
          joinApplication,
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

      case 'submitJoinApplication': {
        if (!openid) return fail('无法获取微信身份', 401)
        const user = await usersDb.ensureUser(openid)
        // 仅已绑定成员档案时拒绝；管理员未绑定时允许提交以便联调
        if (user.memberId) {
          return fail('你已绑定成员档案，无需再次申请', 409)
        }
        const application = await invitesDb.submitJoinApplication(openid, event)
        return ok({ application })
      }

      /** 管理员解除自身绑定，便于联调邀请码入会 */
      case 'unbindSelfForTest': {
        if (!openid) return fail('无法获取微信身份', 401)
        const user = await usersDb.ensureUser(openid)
        if (!usersDb.ADMIN_ROLES.has(user.role)) {
          return fail('仅管理员可解除绑定（联调）', 403)
        }
        if (!user.memberId) {
          return ok({ unbound: false, message: '当前未绑定成员' })
        }
        await membersDb.clearBoundOpenid(user.memberId, openid)
        const next = await usersDb.detachMember(openid)
        return ok({ unbound: true, prevMemberId: next.prevMemberId })
      }

      case 'getMyJoinApplication': {
        if (!openid) return fail('无法获取微信身份', 401)
        return ok(await invitesDb.getMyApplication(openid))
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
          `未知 action: ${action || '(空)'}。支持 health/whoami/bindByCharacterName/submitJoinApplication/getMyJoinApplication/unbindSelfForTest/listMembers/getMember`,
          400,
        )
    }
  } catch (e) {
    console.error('[memberApi]', action, e)
    return fail(e.message || '云函数错误', e.status || 500)
  }
}

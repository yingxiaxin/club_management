/**
 * 成员端云函数：登录身份、入会、成员/活动只读、RSVP、提醒订阅、组队。
 * 调用：cloud.callFunction({ name: 'memberApi', data: { action, ... } })
 */
const cloud = require('wx-server-sdk')
const membersDb = require('./membersDb')
const usersDb = require('./usersDb')
const invitesDb = require('./invitesDb')
const activitiesDb = require('./activitiesDb')
const rsvpsDb = require('./rsvpsDb')
const teamsDb = require('./teamsDb')
const clubDb = require('./clubDb')
const subscriptionsDb = require('./subscriptionsDb')
const announcementsDb = require('./announcementsDb')
const { decorate } = require('./scheduleMatch')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function ok(data) {
  return { ok: true, data }
}

function fail(message, status = 400) {
  return { ok: false, message, status }
}

/**
 * 解析查看权：
 * - 管理员：始终可看（即使用测微信号做过邀请码关联，移出角色后仍可看——这是管理权限）
 * - 普通用户：须挂着 active 成员档案；若档案已 left / 不存在 / 绑定被清，自动 detach 为 guest
 */
async function resolveAccess(openid) {
  let user = await usersDb.ensureUser(openid)
  const isAdmin = usersDb.ADMIN_ROLES.has(user.role)
  let member = null
  if (user.memberId) {
    member = await membersDb.getMember(user.memberId)
  }
  const bindingOk =
    member &&
    member.status !== 'left' &&
    (!member.boundOpenid || member.boundOpenid === openid)

  if (user.memberId && !bindingOk) {
    user = await usersDb.detachMember(openid)
    member = null
  }

  return {
    user,
    member,
    isAdmin,
    canViewMembers: isAdmin || Boolean(user.memberId && bindingOk),
  }
}

async function requireViewer(openid) {
  const access = await resolveAccess(openid)
  if (!access.canViewMembers) {
    const e = new Error('请先绑定俱乐部角色或完成入会后再查看')
    e.status = 403
    throw e
  }
  return access
}

/** RSVP / 组队写操作须绑定有效成员档案（管理员未绑定不可代操作） */
async function requireBoundMember(openid, verb = '操作') {
  const access = await requireViewer(openid)
  if (!access.member || access.member.status === 'left') {
    const e = new Error(`请先绑定俱乐部角色后再${verb}`)
    e.status = 403
    throw e
  }
  return access
}

exports.main = async (event) => {
  const { action } = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    switch (action) {
      case 'health':
        return ok({ service: 'memberApi', store: 'cloud-db', stage: 'P2-a-teams' })

      case 'whoami': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await resolveAccess(openid)
        const { user, member, isAdmin, canViewMembers } = access
        const joinApplication =
          user.memberId && member
            ? null
            : await invitesDb.getMyApplication(openid)
        return ok({
          openid,
          role: user.role,
          displayName: user.displayName || member?.characterName || '',
          memberId: user.memberId,
          member,
          canViewMembers,
          isAdmin,
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
        if (user.memberId) {
          return fail('你已绑定成员档案，无需再次申请', 409)
        }
        const application = await invitesDb.submitJoinApplication(openid, event)
        return ok({ application })
      }

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
        if (!openid) return fail('无法获取微信身份', 401)
        await requireViewer(openid)
        const list = await membersDb.listMembers(event.query || event)
        return ok(list)
      }

      case 'getMember': {
        if (!openid) return fail('无法获取微信身份', 401)
        await requireViewer(openid)
        const row = await membersDb.getMember(event.id)
        if (!row || row.status === 'left') return fail('成员不存在', 404)
        return ok(row)
      }

      case 'listSchedule': {
        if (!openid) return fail('无法获取微信身份', 401)
        await requireViewer(openid)
        return ok(await activitiesDb.listSchedule())
      }

      case 'getActivity': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireViewer(openid)
        const id = event.id || event.activityId
        if (!id) return fail('缺少活动 id', 400)
        const row = await activitiesDb.getPublishedActivity(id, {
          memberId: access.member?.id || access.user.memberId || null,
          openid,
        })
        if (!row) return fail('活动不存在', 404)
        return ok(row)
      }

      case 'getReminderConfig': {
        if (!openid) return fail('无法获取微信身份', 401)
        await requireViewer(openid)
        const club = await clubDb.getClubProfile()
        return ok({
          reminderOffsetsMinutes: club.reminderOffsetsMinutes,
          subscribeTemplateId: club.subscribeTemplateId,
          hasSubscribeTemplate: Boolean(club.subscribeTemplateId),
          subscribeMiniprogramState: club.subscribeMiniprogramState,
        })
      }

      case 'getClubProfile': {
        if (!openid) return fail('无法获取微信身份', 401)
        // 未绑定也可看名称/图标/简介（首页品牌）；不含订阅模板等运营字段
        const club = await clubDb.getClubProfile()
        return ok({
          name: club.name || '',
          iconUrl: club.iconUrl || '',
          intro: club.intro || '',
        })
      }

      case 'listAnnouncements': {
        if (!openid) return fail('无法获取微信身份', 401)
        await requireViewer(openid)
        const list = await announcementsDb.listAnnouncements({
          limit: event.limit,
        })
        return ok(list)
      }

      case 'subscribeActivityReminder': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '订阅提醒')
        const id = event.id || event.activityId
        if (!id) return fail('缺少活动 id', 400)
        const raw = await activitiesDb.getRawPublished(id)
        if (!raw) return fail('活动不存在', 404)
        const activity = decorate(raw)
        if (activity.reminderCycle === 'none') {
          return fail('该活动未开启提醒', 409)
        }
        if (!event.accepted) {
          return fail('需先完成订阅消息授权', 400)
        }
        await subscriptionsDb.upsertActive({
          activityId: id,
          openid,
          memberId: access.member.id,
        })
        const row = await activitiesDb.getPublishedActivity(id, {
          memberId: access.member.id,
          openid,
        })
        return ok(row)
      }

      case 'setRsvp': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '表态')
        const id = event.id || event.activityId
        if (!id) return fail('缺少活动 id', 400)
        const raw = await activitiesDb.getRawPublished(id)
        if (!raw) return fail('活动不存在', 404)
        const activity = decorate(raw)
        if (!activity.canChangeRsvp) {
          return fail(activity.rsvpLockedReason || '当前无法修改意向', 409)
        }
        await rsvpsDb.upsert({
          activityId: id,
          memberId: access.member.id,
          status: event.status,
          characterName: access.member.characterName,
        })
        const row = await activitiesDb.getPublishedActivity(id, {
          memberId: access.member.id,
          openid,
        })
        return ok(row)
      }

      case 'listTeamsByActivity': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '查看组队')
        const activityId = event.activityId || event.id
        const list = await teamsDb.listTeamsByActivity(activityId, access.member.id)
        return ok(list)
      }

      case 'getTeam': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '查看组队')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.getTeamDetail(teamId, access.member.id))
      }

      case 'createTeam': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '建队')
        return ok(await teamsDb.createTeam(event, access.member))
      }

      case 'updateTeam': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '改队')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.updateTeam(teamId, event, access.member.id))
      }

      case 'applyTeam': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '申请入队')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.applyTeam(teamId, event.message, access.member))
      }

      case 'cancelTeamApplication': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '撤回申请')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.cancelTeamApplication(teamId, access.member.id))
      }

      case 'reviewTeamApplication': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '审批')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(
          await teamsDb.reviewTeamApplication(
            teamId,
            event.memberId || event.targetMemberId,
            event.decision,
            access.member.id,
          ),
        )
      }

      case 'kickTeamMember': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '踢人')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(
          await teamsDb.kickTeamMember(
            teamId,
            event.memberId || event.targetMemberId,
            access.member.id,
          ),
        )
      }

      case 'leaveTeam': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '离队')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.leaveTeam(teamId, access.member.id))
      }

      case 'transferTeamLeader': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '转让队长')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(
          await teamsDb.transferTeamLeader(
            teamId,
            event.memberId || event.targetMemberId,
            access.member.id,
          ),
        )
      }

      case 'pauseTeamRecruiting': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '关闭招募')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.pauseTeamRecruiting(teamId, access.member.id))
      }

      case 'resumeTeamRecruiting': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '开启招募')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.resumeTeamRecruiting(teamId, access.member.id))
      }

      case 'dissolveTeam': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '撤销队伍')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.dissolveTeam(teamId, access.member.id))
      }

      case 'closeTeam': {
        // 兼容旧客户端：等同撤销队伍
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '撤销队伍')
        const teamId = event.teamId || event.id
        if (!teamId) return fail('缺少队伍 id', 400)
        return ok(await teamsDb.dissolveTeam(teamId, access.member.id))
      }

      case 'listMyTeams': {
        if (!openid) return fail('无法获取微信身份', 401)
        const access = await requireBoundMember(openid, '查看组队')
        return ok(await teamsDb.listMyTeams(access.member.id, event.filter))
      }

      default:
        return fail(
          `未知 action: ${action || '(空)'}。支持 health/whoami/.../setRsvp/listTeamsByActivity/getTeam/createTeam/updateTeam/applyTeam/cancelTeamApplication/reviewTeamApplication/kickTeamMember/leaveTeam/transferTeamLeader/pauseTeamRecruiting/resumeTeamRecruiting/dissolveTeam/listMyTeams`,
          400,
        )
    }
  } catch (e) {
    console.error('[memberApi]', action, e)
    return fail(e.message || '云函数错误', e.status || 500)
  }
}

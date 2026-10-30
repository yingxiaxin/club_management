/**
 * P1-b 日程匹配冒烟（纯逻辑，不连云库）
 * 用法：node scripts/smoke-p1b-schedule.mjs
 */
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const scheduleMatch = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../functions/memberApi/scheduleMatch.js',
  ),
)

const {
  splitSchedule,
  elevateMultiDayHubsToToday,
  shanghaiParts,
  resolveUrgency,
  resolveOccurrence,
  resolveOccurrenceEndMs,
} = scheduleMatch

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// 固定锚点：2026-10-22 周四（上海）；本周 Mon 10/19～Sun 10/25
const anchor = new Date('2026-10-22T12:00:00+08:00')
const today = shanghaiParts(anchor)
assert(today.year === 2026 && today.month === 10 && today.day === 22, '锚点日期')
assert(today.weekday === 4, `期望周四 weekday=4，实际 ${today.weekday}`)

const cases = [
  {
    name: '仅周几+时间 → 周四今日命中',
    activity: { id: '1', title: '周常', status: 'published', startSchedule: { weekday: 4, time: '20:00' } },
    expectToday: true,
    expectWeek: true,
  },
  {
    name: '仅周几周一 → 本场已过滚到下周一，不在本周列表',
    activity: { id: '2', title: '周一活动', status: 'published', startSchedule: { weekday: 1, time: '21:00' } },
    expectToday: false,
    expectWeek: false,
  },
  {
    name: '仅时间 → 每日，今日+本周',
    activity: { id: '3', title: '每晚', status: 'published', startSchedule: { time: '19:30' } },
    expectToday: true,
    expectWeek: true,
  },
  {
    name: '完整年月日今日',
    activity: {
      id: '4',
      title: '今晚开荒',
      status: 'published',
      startSchedule: { year: 2026, month: 10, day: 22, time: '20:30' },
      startAt: '2026-10-22T12:30:00.000Z',
    },
    expectToday: true,
    expectWeek: true,
  },
  {
    name: '完整年月日下周 → 都不命中',
    activity: {
      id: '5',
      title: '下周',
      status: 'published',
      startSchedule: { year: 2026, month: 10, day: 29, time: '20:00' },
      startAt: '2026-10-29T12:00:00.000Z',
    },
    expectToday: false,
    expectWeek: false,
  },
  {
    name: '日=22 无年月 → 今日命中',
    activity: { id: '6', title: '每月22', status: 'published', startSchedule: { day: 22, time: '18:00' } },
    expectToday: true,
    expectWeek: true,
  },
  {
    name: '整周容器 → 默认只在本周、不在今日',
    activity: {
      id: '7',
      title: '本周自由组队',
      status: 'published',
      startSchedule: { weekday: 1, time: '00:00' },
      endSchedule: { weekday: 7, time: '23:59' },
    },
    expectToday: false,
    expectWeek: true,
    expectPhase: 'live',
  },
  {
    name: '周一～周五容器 → 默认只在本周',
    activity: {
      id: '8',
      title: '工作日容器',
      status: 'published',
      startSchedule: { weekday: 1, time: '00:00' },
      endSchedule: { weekday: 5, time: '23:55' },
    },
    expectToday: false,
    expectWeek: true,
    expectPhase: 'live',
  },
]

let failed = 0
for (const c of cases) {
  const { today: tList, week: wList } = splitSchedule([c.activity], anchor)
  const hitToday = tList.some((x) => x.id === c.activity.id)
  const hitWeek = wList.some((x) => x.id === c.activity.id)
  const row = tList.find((x) => x.id === c.activity.id) || wList.find((x) => x.id === c.activity.id)
  const okToday = hitToday === c.expectToday
  const okWeek = hitWeek === c.expectWeek
  const okPhase = !c.expectPhase || (row && row.occurrencePhase === c.expectPhase)
  if (!okToday || !okWeek || !okPhase) {
    failed += 1
    console.error(
      `FAIL ${c.name}: today=${hitToday}(expect ${c.expectToday}) week=${hitWeek}(expect ${c.expectWeek}) phase=${row?.occurrencePhase}(expect ${c.expectPhase || '-'})`,
    )
  } else {
    console.log(`OK   ${c.name}`)
  }
  assert(tList.every((x) => x.startText), 'decorate 应带 startText')
}

assert(failed === 0, `有 ${failed} 个用例失败`)

// 结束周几：周一开 → 周五 23:55 落在同周周五，而非周一
{
  const mon = { year: 2026, month: 10, day: 19, weekday: 1 }
  const startMs = Date.parse('2026-10-19T00:00:00+08:00')
  const endMs = resolveOccurrenceEndMs(
    {
      startSchedule: { weekday: 1, time: '00:00' },
      endSchedule: { weekday: 5, time: '23:55' },
    },
    startMs,
    mon,
  )
  assert(endMs === Date.parse('2026-10-23T23:55:00+08:00'), `结束应为本周五，得 ${new Date(endMs).toISOString()}`)
  const occ = resolveOccurrence(
    {
      startSchedule: { weekday: 1, time: '00:00' },
      endSchedule: { weekday: 7, time: '23:59' },
    },
    anchor,
  )
  assert(occ.dateKey === '2026-10-19', `整周容器本场开始应为周一，得 ${occ.dateKey}`)
  assert(occ.started && !occ.ended, '周四应在整周窗口进行中')
  console.log('OK   end weekday + week-hub occurrence')
}

// 有今日队伍时抬入今日
{
  const hub = {
    id: 'hub1',
    title: '半周常',
    status: 'published',
    startSchedule: { weekday: 1, time: '00:00' },
    endSchedule: { weekday: 7, time: '23:59' },
  }
  const base = splitSchedule([hub], anchor)
  assert(base.today.length === 0 && base.week.length === 1, '抬升前仅本周')
  const up = elevateMultiDayHubsToToday(base, ['hub1'])
  assert(up.today.some((x) => x.id === 'hub1'), '抬升后进今日')
  assert(up.today[0].elevatedToToday === true, '应标记 elevatedToToday')
  console.log('OK   elevate multi-day hub to today')
}

// 紧迫度：锚点 12:00，活动 12:05 → ≤10min hot；12:40 → soon；14:00 → calm；已过 11:50 → hot
const uHot = resolveUrgency(
  { startSchedule: { year: 2026, month: 10, day: 22, time: '12:05' } },
  anchor,
)
assert(uHot.urgency === 'hot' && uHot.urgencyIcon === '🔥', `期望 hot，得 ${uHot.urgency}`)
const uSoon = resolveUrgency(
  { startSchedule: { year: 2026, month: 10, day: 22, time: '12:40' } },
  anchor,
)
assert(uSoon.urgency === 'soon' && uSoon.urgencyIcon === '⏰', `期望 soon，得 ${uSoon.urgency}`)
const uCalm = resolveUrgency(
  { startSchedule: { year: 2026, month: 10, day: 22, time: '14:00' } },
  anchor,
)
assert(uCalm.urgency === 'calm' && uCalm.urgencyIcon === '🍃', `期望 calm，得 ${uCalm.urgency}`)
const uPast = resolveUrgency(
  { startSchedule: { year: 2026, month: 10, day: 22, time: '11:50' } },
  anchor,
)
assert(uPast.urgency === 'hot', `已开始应 hot，得 ${uPast.urgency}`)
const uNone = resolveUrgency({ startSchedule: { weekday: 4 } }, anchor)
assert(uNone.urgency == null, '无时间应无紧迫度')
console.log('OK   urgency hot/soon/calm/past/none')

console.log('\nsmoke-p1b-schedule: all passed')

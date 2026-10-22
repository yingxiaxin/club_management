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

const { matchesCalendarDay, splitSchedule, shanghaiParts, resolveUrgency } = scheduleMatch

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// 固定锚点：2026-10-22 周四（上海）
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
    name: '仅周几 → 周一不在今日，在本周',
    activity: { id: '2', title: '周一活动', status: 'published', startSchedule: { weekday: 1, time: '21:00' } },
    expectToday: false,
    expectWeek: true,
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
]

let failed = 0
for (const c of cases) {
  const hitToday = matchesCalendarDay(c.activity, today)
  const { today: tList, week: wList } = splitSchedule([c.activity], anchor)
  const hitWeek = wList.some((x) => x.id === c.activity.id)
  const okToday = hitToday === c.expectToday
  const okWeek = hitWeek === c.expectWeek
  if (!okToday || !okWeek) {
    failed += 1
    console.error(`FAIL ${c.name}: today=${hitToday}(expect ${c.expectToday}) week=${hitWeek}(expect ${c.expectWeek})`)
  } else {
    console.log(`OK   ${c.name}`)
  }
  assert(tList.every((x) => x.startText), 'decorate 应带 startText')
}

assert(failed === 0, `有 ${failed} 个用例失败`)

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

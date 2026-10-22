/**
 * 成员端只读 club_profile
 */
const cloud = require('wx-server-sdk')

const COLLECTION = 'club_profile'
const DOC_ID = 'club_main'
const ALLOWED_OFFSETS = new Set([5, 10, 15, 30, 60, 120])

function db() {
  return cloud.database()
}

function normalizeOffsets(raw, fallback = [10]) {
  if (!Array.isArray(raw)) return fallback.slice()
  const nums = [
    ...new Set(
      raw
        .map((n) => Number(n))
        .filter((n) => ALLOWED_OFFSETS.has(n))
        .map((n) => Math.round(n)),
    ),
  ].sort((a, b) => a - b)
  return nums.length ? nums : fallback.slice()
}

async function getClubProfile() {
  try {
    const res = await db().collection(COLLECTION).doc(DOC_ID).get()
    const row = res.data
    if (!row) {
      return {
        reminderOffsetsMinutes: [10],
        subscribeTemplateId: '',
        subscribeMiniprogramState: 'developer',
        name: '',
        iconUrl: '',
        intro: '',
      }
    }
    return {
      name: row.name || '',
      iconUrl: String(row.iconUrl || '').trim(),
      intro: String(row.intro || '').trim(),
      reminderOffsetsMinutes: normalizeOffsets(row.reminderOffsetsMinutes, [10]),
      subscribeTemplateId: String(row.subscribeTemplateId || '').trim(),
      subscribeMiniprogramState: ['developer', 'trial', 'formal'].includes(
        row.subscribeMiniprogramState,
      )
        ? row.subscribeMiniprogramState
        : 'developer',
    }
  } catch {
    return {
      reminderOffsetsMinutes: [10],
      subscribeTemplateId: '',
      subscribeMiniprogramState: 'developer',
      name: '',
      iconUrl: '',
      intro: '',
    }
  }
}

module.exports = {
  getClubProfile,
  normalizeOffsets,
}

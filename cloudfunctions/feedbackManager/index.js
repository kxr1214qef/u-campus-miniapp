/**
 * 意见反馈云函数。
 * 作用：接收小程序自由文本反馈并写入 feedbacks 集合。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_CONTENT_LENGTH = 500

async function getUser(openid) {
  try {
    const res = await db.collection('users').doc(openid).get()
    return res.data || {}
  } catch (error) {
    return {}
  }
}

async function submitFeedback(openid, payload = {}) {
  const content = String(payload.content || '').trim().slice(0, MAX_CONTENT_LENGTH)
  if (!content) {
    throw new Error('请填写反馈内容')
  }

  const user = await getUser(openid)
  const data = {
    openid,
    nickName: String(user.nickName || '').trim(),
    avatarUrl: String(user.avatarUrl || '').trim(),
    content,
    status: 'pending',
    createdAt: new Date()
  }

  const res = await db.collection('feedbacks').add({ data })
  return { success: true, id: res._id }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload } = event || {}

  switch (action) {
    case 'submit': {
      return submitFeedback(OPENID, payload || {})
    }
    default:
      throw new Error(`未知 action: ${action}`)
  }
}

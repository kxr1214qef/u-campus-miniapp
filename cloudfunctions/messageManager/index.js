/**
 * 私信管理云函数。
 * 作用：创建会话、发送消息、读取会话列表与聊天记录，并维护未读数。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_MESSAGE_LENGTH = 200
const MESSAGE_PAGE_SIZE = 200
const READ_MARK_BATCH_SIZE = 100

/** 判断字符串是否为云存储 fileID。 */
function isCloudFileId(value = '') {
  return typeof value === 'string' && value.startsWith('cloud://')
}

/** 判断字符串是否为 HTTP/HTTPS 地址。 */
function isHttpUrl(value = '') {
  return /^https?:\/\//.test(String(value || '').trim())
}

/** 判断是否为云文件临时 HTTP 链接，历史写入后容易过期，不能当作长期封面源。 */
function isCloudTempHttpUrl(value = '') {
  const text = String(value || '').trim()
  return /^https?:\/\/[^/]*tcb\.qcloud\.la\//.test(text) ||
    text.includes('x-cos-security-token') ||
    text.includes('sign=')
}

/** 判断字符串是否为小程序本地临时文件，这类地址不能跨页面/跨设备公开展示。 */
function isTempLocalFile(value = '') {
  const text = String(value || '').trim()
  return text.startsWith('wxfile://') ||
    /^https?:\/\/tmp\//.test(text) ||
    /^https?:\/\/usr\//.test(text) ||
    text.startsWith('tmp/') ||
    text.startsWith('/tmp/') ||
    text.includes('/tmp_') ||
    text.includes('/tmp/')
}

/** 判断商品快照封面是否为合法图片引用。 */
function isValidImageRef(value = '') {
  return !isTempLocalFile(value) &&
    !isCloudTempHttpUrl(value) &&
    (isCloudFileId(value) || isHttpUrl(value))
}

/** 从字符串或常见文件对象中抽取图片引用。 */
function extractImageRef(source) {
  if (!source) return ''
  if (typeof source === 'string') return source.trim()
  if (typeof source !== 'object') return ''
  const candidate = source.fileID ||
    source.fileId ||
    source.cloudPath ||
    source.tempFileURL ||
    source.tempFilePath ||
    source.url ||
    source.src ||
    source.path ||
    source.image ||
    source.imageUrl
  return String(candidate || '').trim()
}

/** 清理商品图片数组，去空、去重并限制数量。 */
function normalizeImageList(images) {
  const list = Array.isArray(images) ? images : [images]
  const dedup = []
  const seen = new Set()
  for (let i = 0; i < list.length; i += 1) {
    const ref = extractImageRef(list[i])
    if (!isValidImageRef(ref) || seen.has(ref)) continue
    seen.add(ref)
    dedup.push(ref)
    if (dedup.length >= 3) break
  }
  return dedup
}

/** 从商品多个历史图片字段中选出会话快照封面。 */
function resolveGoodsCover(item = {}) {
  const images = normalizeImageList([
    ...(Array.isArray(item.images) ? item.images : [item.images]),
    ...(Array.isArray(item.imageList) ? item.imageList : [item.imageList]),
    ...(Array.isArray(item.imageUrls) ? item.imageUrls : [item.imageUrls]),
    item.image,
    item.imageUrl,
    item.cover,
    item.thumb
  ])
  return images[0] || ''
}

/** 统一商品状态，兼容历史中文状态。 */
function normalizeGoodsStatus(status) {
  const text = String(status || '').trim()
  if (!text) return 'on'
  if (['on', 'sold', 'off'].includes(text)) return text
  if (['已售', '售出'].includes(text)) return 'sold'
  if (['下架'].includes(text)) return 'off'
  return 'on'
}

function normalizePublishType(value = '') {
  const text = String(value || '').trim()
  if (['wanted', 'demand', 'need', 'want', '求购', '需求', '我想收'].includes(text)) return 'wanted'
  return 'idle'
}

/** 清理 openid 字符串。 */
function normalizeOpenid(value = '') {
  return String(value || '').trim()
}

/** 获取卖家 openid，兼容旧字段并支持前端兜底传入。 */
function pickOwnerOpenid(data = {}, fallbackSellerOpenid = '') {
  return normalizeOpenid(
    data.ownerOpenid ||
    data._openid ||
    data.sellerOpenid ||
    data.publisherOpenid ||
    fallbackSellerOpenid
  )
}

/** 根据当前用户判断会话中的对方 openid。 */
function pickOtherOpenid(conversation = {}, openid = '') {
  if (!conversation) return ''
  return conversation.sellerOpenid === openid ? conversation.buyerOpenid : conversation.sellerOpenid
}

/** 回填商品历史兼容字段，失败不影响私信流程。 */
async function syncLegacyGoodsFields(goodsId, updateData = {}) {
  const payload = { ...updateData }
  if (!Object.keys(payload).length) return
  if (payload.updatedAt === undefined) {
    payload.updatedAt = new Date()
  }
  try {
    await db.collection('goods').doc(goodsId).update({ data: payload })
  } catch (error) {
    // 忽略历史数据回填失败，不影响主流程
  }
}

/** 获取当前微信上下文。 */
function getContext() {
  return cloud.getWXContext()
}

/** 读取用户。 */
async function getUser(openid) {
  try {
    const res = await db.collection('users').doc(openid).get()
    return res.data
  } catch (error) {
    return null
  }
}

/** 读取商品。 */
async function getGoods(goodsId, fallbackSellerOpenid = '') {
  if (!goodsId) {
    throw new Error('商品不存在')
  }
  const res = await db.collection('goods').doc(goodsId).get()
  const data = res.data || {}
  const ownerOpenid = pickOwnerOpenid(data, fallbackSellerOpenid)
  const status = normalizeGoodsStatus(data.status)
  const publishType = normalizePublishType(data.publishType || data.type)
  const patch = {}
  if (!data.ownerOpenid && ownerOpenid) patch.ownerOpenid = ownerOpenid
  if (status !== data.status) patch.status = status
  if (!data.publishType) patch.publishType = publishType
  if (Object.keys(patch).length) {
    await syncLegacyGoodsFields(goodsId, patch)
  }
  const normalizedImages = normalizeImageList(data.images)
  const cover = resolveGoodsCover(data)
  return {
    ...data,
    ownerOpenid,
    status,
    publishType,
    images: normalizedImages.length ? normalizedImages : (cover ? [cover] : [])
  }
}

async function getGoodsCoverSource(goodsId = '') {
  if (!goodsId) return ''
  try {
    const res = await db.collection('goods').doc(goodsId).get()
    return resolveGoodsCover(res.data || {})
  } catch (error) {
    return ''
  }
}

async function resolveConversationCoverSource(conversation = {}) {
  const snapshot = conversation.goodsSnapshot || {}
  const snapshotCover = String(snapshot.cover || '').trim()
  if (isValidImageRef(snapshotCover)) return snapshotCover
  return getGoodsCoverSource(conversation.goodsId)
}

/** 读取会话。 */
async function getConversation(conversationId) {
  if (!conversationId) {
    throw new Error('会话不存在')
  }
  const res = await db.collection('conversations').doc(conversationId).get()
  return {
    ...(res.data || {}),
    _id: (res.data && res.data._id) || conversationId
  }
}

/** 清理消息内容并限制最大长度。 */
function trimMessage(content) {
  return String(content || '').trim().slice(0, MAX_MESSAGE_LENGTH)
}

/**
 * 校验当前用户是否属于该会话。
 * 原理：只有买家或卖家本人才能读写对应聊天记录。
 */
function assertConversationMember(conversation, openid) {
  if (!conversation || (conversation.sellerOpenid !== openid && conversation.buyerOpenid !== openid)) {
    throw new Error('无权访问该会话')
  }
}

/**
 * 确保会话存在。
 * 原理：同一件商品、同一买家与卖家之间只创建一个 conversation。
 */
async function ensureConversation(openid, goodsId, fallbackSellerOpenid = '') {
  const goods = await getGoods(goodsId, fallbackSellerOpenid)
  if (!goods) {
    throw new Error('商品不存在或已删除')
  }
  if (goods.status !== 'on') {
    throw new Error('该商品当前不可私信')
  }
  const sellerOpenid = normalizeOpenid(goods.ownerOpenid || fallbackSellerOpenid)
  if (!sellerOpenid) {
    throw new Error('商品缺少卖家信息，暂时无法私信')
  }
  if (openid === sellerOpenid) {
    throw new Error('不能给自己发私信')
  }
  const buyerOpenid = openid
  const existing = await db.collection('conversations')
    .where({ goodsId, sellerOpenid, buyerOpenid })
    .limit(1)
    .get()

  if (existing.data && existing.data.length) {
    const conversation = existing.data[0]
    if (!String(conversation.lastMessage || '').trim()) {
      await sendIntentMessage(
        openid,
        conversation._id,
        goodsId,
        { ...goods, ownerOpenid: sellerOpenid },
        conversation.unreadMap || {}
      )
      return {
        conversationId: conversation._id,
        created: true
      }
    }
    return {
      conversationId: conversation._id,
      created: false
    }
  }

  const data = {
    goodsId,
    sellerOpenid,
    buyerOpenid,
    participants: [sellerOpenid, buyerOpenid],
    goodsSnapshot: {
      title: goods.title,
      price: goods.price,
      category: goods.category,
      publishType: goods.publishType,
      cover: resolveGoodsCover(goods)
    },
    lastMessage: '',
    lastMessageAt: new Date(),
    unreadMap: {
      [sellerOpenid]: 0,
      [buyerOpenid]: 0
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }
  const res = await db.collection('conversations').add({ data })
  await sendIntentMessage(openid, res._id, goodsId, { ...goods, ownerOpenid: sellerOpenid }, data.unreadMap)
  return {
    conversationId: res._id,
    created: true
  }
}

/** 创建会话后自动发送购买意向消息。 */
async function sendIntentMessage(buyerOpenid, conversationId, goodsId, goods, unreadMap = {}) {
  const title = String(goods && goods.title ? goods.title : '该商品').slice(0, 30)
  const content = goods && goods.publishType === 'wanted'
    ? `你好，我看到你发布的需求「${title}」，方便聊聊吗？`
    : `你好，我对你发布的「${title}」感兴趣，方便聊聊吗？`
  await db.collection('messages').add({
    data: {
      conversationId,
      goodsId,
      fromOpenid: buyerOpenid,
      toOpenid: goods.ownerOpenid,
      content,
      type: 'text',
      read: false,
      createdAt: new Date()
    }
  })

  await db.collection('conversations').doc(conversationId).update({
    data: {
      lastMessage: content,
      lastMessageAt: new Date(),
      unreadMap: {
        ...unreadMap,
        [goods.ownerOpenid]: Number((unreadMap && unreadMap[goods.ownerOpenid]) || 0) + 1,
        [buyerOpenid]: 0
      },
      updatedAt: new Date()
    }
  })
}

/** 获取会话列表。 */
async function listConversations(openid) {
  const [sellerRes, buyerRes] = await Promise.all([
    db.collection('conversations').where({ sellerOpenid: openid }).limit(100).get(),
    db.collection('conversations').where({ buyerOpenid: openid }).limit(100).get()
  ])

  const dedupMap = new Map()
  const merged = [...(sellerRes.data || []), ...(buyerRes.data || [])]
  merged.forEach((item) => {
    if (item && item._id && !dedupMap.has(item._id)) {
      dedupMap.set(item._id, item)
    }
  })
  const deduped = Array.from(dedupMap.values())
  deduped.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

  const list = await Promise.all(deduped.map(async (item) => {
    const otherOpenid = pickOtherOpenid(item, openid)
    const otherUser = (await getUser(otherOpenid)) || { nickName: '热心同学', avatarUrl: '', wechatNumber: '' }
    const coverSourceUrl = await resolveConversationCoverSource(item)
    const [coverUrl, avatarUrl] = await Promise.all([
      toTempUrl(coverSourceUrl),
      toTempUrl(otherUser.avatarUrl)
    ])
    return {
      ...item,
      otherOpenid,
      goodsSnapshot: {
        ...(item.goodsSnapshot || {}),
        coverSourceUrl,
        cover: coverUrl
      },
      otherUser: {
        ...otherUser,
        avatarSourceUrl: otherUser.avatarUrl || '',
        avatarUrl: avatarUrl || keepAvatarWhenDisplayable(otherUser.avatarUrl)
      },
      unreadCount: item.unreadMap && item.unreadMap[openid] ? item.unreadMap[openid] : 0
    }
  }))
  return list
}

/**
 * 获取会话中的全部消息，并把当前用户未读数清零。
 */
async function listMessages(openid, conversationId) {
  const conversation = await getConversation(conversationId)
  assertConversationMember(conversation, openid)

  const res = await db.collection('messages')
    .where({ conversationId })
    .orderBy('createdAt', 'asc')
    .limit(MESSAGE_PAGE_SIZE)
    .get()

  await markConversationMessagesRead(conversationId, openid)

  const unreadMap = {
    ...(conversation.unreadMap || {}),
    [openid]: 0
  }
  await db.collection('conversations').doc(conversationId).update({
    data: {
      unreadMap,
      updatedAt: new Date()
    }
  })

  const otherOpenid = pickOtherOpenid(conversation, openid)
  const otherUser = (await getUser(otherOpenid)) || { nickName: '热心同学', avatarUrl: '', wechatNumber: '' }
  const coverSourceUrl = await resolveConversationCoverSource(conversation)
  const [coverUrl, avatarUrl] = await Promise.all([
    toTempUrl(coverSourceUrl),
    toTempUrl(otherUser.avatarUrl)
  ])

  return {
    conversation: {
      ...conversation,
      goodsSnapshot: {
        ...(conversation.goodsSnapshot || {}),
        coverSourceUrl,
        cover: coverUrl
      },
      unreadMap
    },
    messages: res.data || [],
    otherOpenid,
    otherUser: {
      ...otherUser,
      avatarSourceUrl: otherUser.avatarUrl || '',
      avatarUrl: avatarUrl || keepAvatarWhenDisplayable(otherUser.avatarUrl)
    }
  }
}

async function findPeerConversations(openid, peerOpenid = '', conversationId = '') {
  let normalizedPeerOpenid = normalizeOpenid(peerOpenid)
  let anchorConversation = null

  if (!normalizedPeerOpenid && conversationId) {
    anchorConversation = await getConversation(conversationId)
    assertConversationMember(anchorConversation, openid)
    normalizedPeerOpenid = pickOtherOpenid(anchorConversation, openid)
  }
  if (!normalizedPeerOpenid) {
    throw new Error('缺少对方用户')
  }

  const [asSeller, asBuyer] = await Promise.all([
    db.collection('conversations').where({ sellerOpenid: openid, buyerOpenid: normalizedPeerOpenid }).limit(100).get(),
    db.collection('conversations').where({ sellerOpenid: normalizedPeerOpenid, buyerOpenid: openid }).limit(100).get()
  ])

  const dedup = new Map()
  ;[anchorConversation, ...(asSeller.data || []), ...(asBuyer.data || [])].forEach((item) => {
    if (!item || !item._id) return
    dedup.set(item._id, item)
  })
  const list = Array.from(dedup.values())
  list.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
  return {
    peerOpenid: normalizedPeerOpenid,
    conversations: list
  }
}

async function hydratePeerConversation(conversation = {}, openid = '', otherUser = {}) {
  const coverSourceUrl = await resolveConversationCoverSource(conversation)
  const coverUrl = await toTempUrl(coverSourceUrl)
  return {
    ...conversation,
    otherOpenid: pickOtherOpenid(conversation, openid),
    goodsSnapshot: {
      ...(conversation.goodsSnapshot || {}),
      coverSourceUrl,
      cover: coverUrl
    },
    unreadCount: conversation.unreadMap && conversation.unreadMap[openid] ? conversation.unreadMap[openid] : 0,
    otherUser
  }
}

async function markPeerConversationsRead(conversations = [], openid = '') {
  await Promise.all(conversations.map(async (conversation) => {
    if (!conversation || !conversation._id) return
    await markConversationMessagesRead(conversation._id, openid)
    const unreadMap = {
      ...(conversation.unreadMap || {}),
      [openid]: 0
    }
    conversation.unreadMap = unreadMap
    await db.collection('conversations').doc(conversation._id).update({
      data: {
        unreadMap,
        updatedAt: new Date()
      }
    })
  }))
}

/** 按对方用户聚合读取消息，聊天页可以一次渲染同一个人的全部商品会话。 */
async function listMessagesByPeer(openid, peerOpenid = '', conversationId = '') {
  const peerBundle = await findPeerConversations(openid, peerOpenid, conversationId)
  const conversations = peerBundle.conversations || []
  if (!conversations.length) {
    throw new Error('会话不存在')
  }

  await markPeerConversationsRead(conversations, openid)

  const otherUserRaw = (await getUser(peerBundle.peerOpenid)) || { nickName: '热心同学', avatarUrl: '', wechatNumber: '' }
  const avatarUrl = await toTempUrl(otherUserRaw.avatarUrl)
  const otherUser = {
    ...otherUserRaw,
    avatarSourceUrl: otherUserRaw.avatarUrl || '',
    avatarUrl: avatarUrl || keepAvatarWhenDisplayable(otherUserRaw.avatarUrl)
  }

  const hydratedConversations = await Promise.all(
    conversations.map((item) => hydratePeerConversation(item, openid, otherUser))
  )
  const primaryConversation = (
    conversationId && hydratedConversations.find((item) => item._id === conversationId)
  ) || hydratedConversations[0]

  const messageResults = await Promise.all(conversations.map(async (conversation) => {
    const res = await db.collection('messages')
      .where({ conversationId: conversation._id })
      .orderBy('createdAt', 'asc')
      .limit(MESSAGE_PAGE_SIZE)
      .get()
    const snapshot = conversation.goodsSnapshot || {}
    return (res.data || []).map((message) => ({
      ...message,
      goodsId: message.goodsId || conversation.goodsId,
      goodsSnapshot: snapshot
    }))
  }))
  const messages = messageResults.reduce((acc, list) => acc.concat(list), [])
  messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return {
    conversation: primaryConversation,
    conversations: hydratedConversations,
    primaryConversationId: primaryConversation && primaryConversation._id,
    peerOpenid: peerBundle.peerOpenid,
    otherOpenid: peerBundle.peerOpenid,
    messages,
    otherUser
  }
}

/**
 * 把云存储 fileID 转成临时链接。
 * 修复点：转换失败返回空字符串而不是 cloud://，避免前端 image 组件直接渲染失效地址。
 */
async function toTempUrl(value) {
  if (isTempLocalFile(value)) return ''
  if (!isCloudFileId(value)) return value || ''
  try {
    const res = await cloud.getTempFileURL({ fileList: [value] })
    const item = res.fileList && res.fileList[0]
    return (item && item.tempFileURL) || ''
  } catch (error) {
    return ''
  }
}


/** cloud:// 头像转换失败时不再回传原始 fileID，普通 HTTP 头像则保留。 */
function keepAvatarWhenDisplayable(value = '') {
  if (isCloudFileId(value) || isTempLocalFile(value)) return ''
  return value || ''
}

/** 把当前会话中发给自己的未读消息批量标记为已读。 */
async function markConversationMessagesRead(conversationId, openid) {
  while (true) {
    const unread = await db.collection('messages')
      .where({ conversationId, toOpenid: openid, read: false })
      .limit(READ_MARK_BATCH_SIZE)
      .get()

    const unreadMessages = unread.data || []
    if (!unreadMessages.length) break
    await Promise.all(
      unreadMessages.map((item) => db.collection('messages').doc(item._id).update({ data: { read: true } }))
    )
    if (unreadMessages.length < READ_MARK_BATCH_SIZE) break
  }
}

async function countUnreadMessages(conversationId, toOpenid) {
  const res = await db.collection('messages')
    .where({ conversationId, toOpenid, read: false })
    .count()
  return Number(res.total || 0)
}

async function refreshConversationSummary(conversation = {}) {
  const conversationId = conversation._id
  if (!conversationId) return

  const latestRes = await db.collection('messages')
    .where({ conversationId })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  const latestMessage = (latestRes.data || [])[0] || null
  const participants = Array.isArray(conversation.participants) && conversation.participants.length
    ? conversation.participants
    : [conversation.sellerOpenid, conversation.buyerOpenid].filter(Boolean)
  const unreadPairs = await Promise.all(participants.map(async (openid) => ({
    openid,
    count: await countUnreadMessages(conversationId, openid)
  })))
  const unreadMap = unreadPairs.reduce((acc, item) => {
    if (item.openid) acc[item.openid] = item.count
    return acc
  }, {})

  await db.collection('conversations').doc(conversationId).update({
    data: {
      lastMessage: latestMessage ? latestMessage.content : '',
      lastMessageAt: latestMessage ? latestMessage.createdAt : (conversation.createdAt || new Date()),
      unreadMap,
      updatedAt: new Date()
    }
  })
}

/** 删除某个会话下的所有消息。 */
async function removeMessagesByConversation(conversationId) {
  while (true) {
    const msgRes = await db.collection('messages').where({ conversationId }).limit(100).get()
    const messages = msgRes.data || []
    if (!messages.length) break
    await Promise.all(messages.map((item) => db.collection('messages').doc(item._id).remove()))
    if (messages.length < 100) break
  }
}

async function deleteConversation(openid, conversationId = '', peerOpenid = '') {
  const normalizedPeerOpenid = normalizeOpenid(peerOpenid)
  const conversations = normalizedPeerOpenid
    ? (await findPeerConversations(openid, normalizedPeerOpenid, conversationId)).conversations
    : [await getConversation(conversationId)]

  if (!conversations.length) {
    throw new Error('会话不存在')
  }

  for (const conversation of conversations) {
    assertConversationMember(conversation, openid)
    await removeMessagesByConversation(conversation._id)
  }
  await Promise.all(conversations.map((item) => db.collection('conversations').doc(item._id).remove()))

  return {
    success: true,
    deletedCount: conversations.length
  }
}

async function deleteMessage(openid, messageId = '') {
  if (!messageId) {
    throw new Error('消息不存在')
  }
  const res = await db.collection('messages').doc(messageId).get()
  const message = res.data || null
  if (!message || !message.conversationId) {
    throw new Error('消息不存在')
  }
  const conversation = await getConversation(message.conversationId)
  assertConversationMember(conversation, openid)

  await db.collection('messages').doc(messageId).remove()
  await refreshConversationSummary(conversation)

  return {
    success: true
  }
}

/**
 * 发送一条文字消息。
 * 原理：消息入库后同步刷新会话表里的 lastMessage / lastMessageAt / unreadMap。
 */
async function sendMessage(openid, conversationId, content) {
  const conversation = await getConversation(conversationId)
  assertConversationMember(conversation, openid)

  const text = trimMessage(content)
  if (!text) throw new Error('消息内容不能为空')

  const toOpenid = pickOtherOpenid(conversation, openid)
  await db.collection('messages').add({
    data: {
      conversationId,
      goodsId: conversation.goodsId,
      fromOpenid: openid,
      toOpenid,
      content: text,
      type: 'text',
      read: false,
      createdAt: new Date()
    }
  })

  const unreadMap = {
    ...(conversation.unreadMap || {}),
    [toOpenid]: Number((conversation.unreadMap && conversation.unreadMap[toOpenid]) || 0) + 1,
    [openid]: 0
  }

  await db.collection('conversations').doc(conversationId).update({
    data: {
      lastMessage: text,
      lastMessageAt: new Date(),
      unreadMap,
      updatedAt: new Date()
    }
  })

  return true
}

/** 云函数主入口。 */
exports.main = async (event) => {
  const { OPENID } = getContext()
  const { action, goodsId, conversationId, content, sellerOpenid, peerOpenid, messageId } = event

  switch (action) {
    case 'ensureConversation': {
      return ensureConversation(OPENID, goodsId, sellerOpenid)
    }
    case 'listConversations': {
      const list = await listConversations(OPENID)
      return { list }
    }
    case 'listMessages': {
      return listMessages(OPENID, conversationId)
    }
    case 'listMessagesByPeer': {
      return listMessagesByPeer(OPENID, peerOpenid, conversationId)
    }
    case 'sendMessage': {
      await sendMessage(OPENID, conversationId, content)
      return { success: true }
    }
    case 'deleteConversation': {
      return deleteConversation(OPENID, conversationId, peerOpenid)
    }
    case 'deleteMessage': {
      return deleteMessage(OPENID, messageId)
    }
    default:
      throw new Error(`未知 action: ${action}`)
  }
}

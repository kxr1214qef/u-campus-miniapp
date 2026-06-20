const app = getApp()
const { listConversations } = require('../../utils/api')
const { formatRelativeTime } = require('../../utils/time')
const { defaultAvatar, defaultGoodsCover, getDisplayCategory } = require('../../config/index')
const { resolveDisplayUrlList, isDisplayableImage } = require('../../utils/file')
const { requireLogin, buildLoginUrl } = require('../../utils/auth')

const CACHE_PREFIX = 'message_user_groups_v1'
const HIDDEN_CACHE_PREFIX = 'message_hidden_groups_v1'
const WATCH_REFRESH_DELAY = 180

function getTimeValue(input) {
  if (!input) return 0
  if (input instanceof Date) return input.getTime()
  if (input && input.toDate) return input.toDate().getTime()
  if (input && input.$date) return new Date(input.$date).getTime()
  return new Date(input).getTime() || 0
}

function getOtherOpenid(item = {}) {
  return String(
    item.otherOpenid ||
    (item.otherUser && (item.otherUser._id || item.otherUser.openid)) ||
    ''
  ).trim()
}

function getAvatarSource(item = {}) {
  const otherUser = item.otherUser || {}
  return String(otherUser.avatarSourceUrl || otherUser.avatarUrl || '').trim()
}

function getAvatarFallbackSource(item = {}) {
  const otherUser = item.otherUser || {}
  return String(otherUser.avatarUrl || '').trim()
}

function getCoverSource(item = {}) {
  const snapshot = item.goodsSnapshot || {}
  return String(snapshot.coverSourceUrl || snapshot.cover || '').trim()
}

function getCoverFallbackSource(item = {}) {
  const snapshot = item.goodsSnapshot || {}
  return String(snapshot.cover || '').trim()
}

function formatGoodsSnapshot(snapshot = {}) {
  return {
    ...snapshot,
    displayCategory: getDisplayCategory(snapshot.category, snapshot.tags)
  }
}

function buildConversationGroups(rawList = []) {
  const groups = new Map()
  ;(rawList || []).forEach((item) => {
    if (!item || !item._id) return
    const peerOpenid = getOtherOpenid(item)
    const key = peerOpenid || item._id
    const itemTime = getTimeValue(item.lastMessageAt)
    const current = groups.get(key) || {
      _id: key,
      peerOpenid,
      conversationId: item._id,
      conversations: [],
      relatedCount: 0,
      unreadCount: 0,
      _lastTime: 0
    }

    current.conversations.push(item)
    current.relatedCount = current.conversations.length
    current.unreadCount += Number(item.unreadCount || 0)

    if (itemTime >= current._lastTime) {
      current._lastTime = itemTime
      current.conversationId = item._id
      current.lastMessage = item.lastMessage || ''
      current.lastMessageAt = item.lastMessageAt
      current.displayTime = formatRelativeTime(item.lastMessageAt)
      current.otherUser = item.otherUser || {}
      current.goodsSnapshot = formatGoodsSnapshot(item.goodsSnapshot || {})
      current.goodsPriceText = current.goodsSnapshot.publishType === 'wanted'
        ? `预算 ￥${current.goodsSnapshot.price}`
        : `￥${current.goodsSnapshot.price}`
      current.otherAvatarSource = getAvatarSource(item)
      current.otherAvatarFallbackSource = getAvatarFallbackSource(item)
      current.goodsCoverSource = getCoverSource(item)
      current.goodsCoverFallbackSource = getCoverFallbackSource(item)
    }

    groups.set(key, current)
  })

  return Array.from(groups.values()).sort((a, b) => b._lastTime - a._lastTime)
}

function buildDisplayCache(list = []) {
  return (list || []).reduce((acc, item) => {
    if (item && item._id) acc[item._id] = item
    return acc
  }, {})
}

function canReuseImage(value = '', fallback = '') {
  return value &&
    value !== fallback &&
    isDisplayableImage(value)
}

function isSameConversationList(prev = [], next = []) {
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i += 1) {
    const oldItem = prev[i] || {}
    const nextItem = next[i] || {}
    if (
      oldItem._id !== nextItem._id ||
      oldItem.conversationId !== nextItem.conversationId ||
      oldItem.lastMessage !== nextItem.lastMessage ||
      oldItem.unreadCount !== nextItem.unreadCount ||
      oldItem.displayTime !== nextItem.displayTime ||
      oldItem.otherAvatar !== nextItem.otherAvatar ||
      oldItem.goodsCover !== nextItem.goodsCover ||
      oldItem.relatedCount !== nextItem.relatedCount ||
      ((oldItem.otherUser || {}).nickName || '') !== ((nextItem.otherUser || {}).nickName || '') ||
      ((oldItem.goodsSnapshot || {}).title || '') !== ((nextItem.goodsSnapshot || {}).title || '') ||
      ((oldItem.goodsSnapshot || {}).category || '') !== ((nextItem.goodsSnapshot || {}).category || '') ||
      ((oldItem.goodsSnapshot || {}).price || '') !== ((nextItem.goodsSnapshot || {}).price || '')
    ) {
      return false
    }
  }
  return true
}

Page({
  data: {
    conversations: [],
    loading: false,
    loginChecked: false,
    canUseMessage: false,
    defaultAvatar,
    defaultGoodsCover
  },

  realtimeWatchers: [],
  refreshTimer: null,
  refreshingConversations: false,
  refreshPending: false,
  hasLoadedConversations: false,

  getCacheKey() {
    return `${CACHE_PREFIX}_${app.globalData.openid || 'guest'}`
  },

  getHiddenCacheKey() {
    return `${HIDDEN_CACHE_PREFIX}_${app.globalData.openid || 'guest'}`
  },

  /** 首次进入页面时等待 onShow 统一校验登录并加载会话。 */
  onLoad() {},

  /** 每次展示页面时同步 tabBar，并确保实时监听已启动。 */
  async onShow() {
    this.syncTabBar()
    const canUseMessage = await this.ensureMessageLogin(true)
    if (canUseMessage) {
      if (!this.data.conversations.length) {
        this.loadCachedConversations()
      }
      const needsConfirmRefresh = !!app.globalData.messageNeedsRefresh
      this.applyPendingReadSync()
      this.startRealtimeWatch()
      if (!this.hasLoadedConversations) {
        app.globalData.messageNeedsRefresh = false
        this.loadConversations(false)
      } else if (needsConfirmRefresh) {
        app.globalData.messageNeedsRefresh = false
        this.loadConversations(false)
      }
    } else {
      this.stopRealtimeWatch()
    }
  },

  onUnload() {
    this.stopRealtimeWatch()
    this.clearRefreshTimer()
  },

  /** 同步自定义 tabBar 的当前选中页面。 */
  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/message/message' })
      this.refreshTabBarUnread()
    }
  },

  refreshTabBarUnread() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && typeof tabBar.refreshUnreadCount === 'function') {
      tabBar.refreshUnreadCount()
    }
  },

  syncTabBarUnreadFromLocal() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      const unreadCount = this.data.conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0)
      tabBar.setData({ unreadCount })
    }
  },

  async ensureMessageLogin(showModal = true) {
    const canUseMessage = await requireLogin({
      title: '先登录再查看私信',
      content: '完善昵称并保存后，就可以查看和发送私信。',
      from: 'message',
      silent: !showModal
    })
    this.setData({
      loginChecked: true,
      canUseMessage
    })
    return canUseMessage
  },

  goLoginPage() {
    wx.navigateTo({ url: buildLoginUrl('message') })
  },

  loadCachedConversations() {
    try {
      const cache = wx.getStorageSync(this.getCacheKey())
      if (cache && Array.isArray(cache.list) && cache.list.length) {
        const conversations = cache.list.map((item) => ({
          ...item,
          otherAvatar: defaultAvatar,
          goodsCover: defaultGoodsCover
        }))
        this.setData({ conversations })
      }
    } catch (error) {
      console.warn('读取私信缓存失败：', error)
    }
  },

  saveConversationCache(conversations = []) {
    try {
      const list = conversations.map((item) => ({
        ...item,
        otherAvatar: defaultAvatar,
        goodsCover: defaultGoodsCover
      }))
      wx.setStorageSync(this.getCacheKey(), {
        savedAt: Date.now(),
        list
      })
    } catch (error) {
      console.warn('写入私信缓存失败：', error)
    }
  },

  getHiddenGroupIds() {
    try {
      const list = wx.getStorageSync(this.getHiddenCacheKey())
      return Array.isArray(list) ? list : []
    } catch (error) {
      console.warn('读取本地隐藏会话失败：', error)
      return []
    }
  },

  saveHiddenGroupIds(list = []) {
    try {
      wx.setStorageSync(this.getHiddenCacheKey(), Array.from(new Set(list.filter(Boolean))))
    } catch (error) {
      console.warn('写入本地隐藏会话失败：', error)
    }
  },

  filterHiddenGroups(groups = []) {
    const hiddenIds = this.getHiddenGroupIds()
    if (!hiddenIds.length) return groups
    return groups.filter((item) => !hiddenIds.includes(item._id))
  },

  applyPendingReadSync() {
    const sync = app.globalData.messageReadSync
    if (!sync) return
    this.markPeerReadLocally(sync)
    app.globalData.messageReadSync = null
  },

  markPeerReadLocally(options = {}) {
    const peerOpenid = String(options.peerOpenid || '').trim()
    const conversationIds = new Set(Array.isArray(options.conversationIds) ? options.conversationIds : [])
    if (!peerOpenid && !conversationIds.size) return

    let changed = false
    const conversations = this.data.conversations.map((item) => {
      const relatedIds = Array.isArray(item.conversations)
        ? item.conversations.map((conversation) => conversation && conversation._id).filter(Boolean)
        : []
      const matched = (peerOpenid && item.peerOpenid === peerOpenid) ||
        (item.conversationId && conversationIds.has(item.conversationId)) ||
        relatedIds.some((id) => conversationIds.has(id))

      if (!matched || Number(item.unreadCount || 0) === 0) return item
      changed = true
      return {
        ...item,
        unreadCount: 0,
        conversations: Array.isArray(item.conversations)
          ? item.conversations.map((conversation) => ({
              ...conversation,
              unreadCount: 0
            }))
          : item.conversations
      }
    })

    if (!changed) return
    this.setData({ conversations })
    this.saveConversationCache(conversations)
    this.syncTabBarUnreadFromLocal()
  },

  async hydrateGroupImages(groups = []) {
    const displayCache = buildDisplayCache(this.data.conversations)
    const imageReuseState = groups.map((item) => {
      const cached = displayCache[item._id] || {}
      return {
        cached,
        reuseAvatar: cached.otherAvatarSource === item.otherAvatarSource &&
          canReuseImage(cached.otherAvatar, defaultAvatar),
        reuseCover: cached.goodsCoverSource === item.goodsCoverSource &&
          canReuseImage(cached.goodsCover, defaultGoodsCover)
      }
    })
    const avatarRefs = groups.map((item, index) => imageReuseState[index].reuseAvatar ? '' : (item.otherAvatarSource || ''))
    const avatarFallbackRefs = groups.map((item, index) => imageReuseState[index].reuseAvatar ? '' : (item.otherAvatarFallbackSource || ''))
    const coverRefs = groups.map((item, index) => imageReuseState[index].reuseCover ? '' : (item.goodsCoverSource || ''))
    const coverFallbackRefs = groups.map((item, index) => imageReuseState[index].reuseCover ? '' : (item.goodsCoverFallbackSource || ''))
    const [avatars, fallbackAvatars, covers, fallbackCovers] = await Promise.all([
      resolveDisplayUrlList(avatarRefs, defaultAvatar),
      resolveDisplayUrlList(avatarFallbackRefs, defaultAvatar),
      resolveDisplayUrlList(coverRefs, defaultGoodsCover),
      resolveDisplayUrlList(coverFallbackRefs, defaultGoodsCover)
    ])

    return groups.map((item, index) => {
      const { cached, reuseAvatar, reuseCover } = imageReuseState[index]
      return {
        ...item,
        otherAvatar: reuseAvatar
          ? cached.otherAvatar
          : (avatars[index] !== defaultAvatar
          ? avatars[index]
          : (fallbackAvatars[index] || defaultAvatar)),
        goodsCover: reuseCover
          ? cached.goodsCover
          : (covers[index] !== defaultGoodsCover
          ? covers[index]
          : (fallbackCovers[index] || defaultGoodsCover))
      }
    })
  },

  onConversationAvatarError(e) {
    const groupId = e.currentTarget.dataset.groupId || ''
    if (!groupId) return
    const conversations = this.data.conversations.map((item) => (
      item._id === groupId ? { ...item, otherAvatar: defaultAvatar } : item
    ))
    this.setData({ conversations })
  },

  onConversationCoverError(e) {
    const groupId = e.currentTarget.dataset.groupId || ''
    if (!groupId) return
    const conversations = this.data.conversations.map((item) => (
      item._id === groupId ? { ...item, goodsCover: defaultGoodsCover } : item
    ))
    this.setData({ conversations })
  },

  /**
   * 拉取当前用户的全部会话。
   * 修复点：会话按用户聚合，并复用缓存里的缩略图展示地址，避免频繁刷新闪烁。
   */
  async loadConversations(showLoading = true) {
    if (!this.data.canUseMessage) return
    if (this.refreshingConversations) {
      this.refreshPending = true
      return
    }
    this.refreshingConversations = true
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await listConversations()
      const rawList = res.list || []
      const groups = this.filterHiddenGroups(buildConversationGroups(rawList))
      const conversations = await this.hydrateGroupImages(groups)
      if (!isSameConversationList(this.data.conversations, conversations)) {
        this.setData({ conversations })
      }
      this.hasLoadedConversations = true
      this.saveConversationCache(conversations)
      this.refreshTabBarUnread()
    } catch (error) {
      console.error('会话列表获取失败：', error)
      wx.showToast({ title: '私信加载失败', icon: 'none' })
    } finally {
      this.refreshingConversations = false
      this.setData({ loading: false })
      if (this.refreshPending) {
        this.refreshPending = false
        this.scheduleConversationRefresh()
      }
    }
  },

  startRealtimeWatch() {
    if (this.realtimeWatchers.length || !wx.cloud || !app.globalData.openid) return
    const db = wx.cloud.database()
    const openid = app.globalData.openid
    const watchTargets = [
      { collection: 'conversations', where: { sellerOpenid: openid } },
      { collection: 'conversations', where: { buyerOpenid: openid } },
      { collection: 'messages', where: { toOpenid: openid } }
    ]

    try {
      this.realtimeWatchers = watchTargets.map((target) => db.collection(target.collection)
        .where(target.where)
        .watch({
          onChange: (snapshot) => {
            if (snapshot && snapshot.type === 'init') return
            this.scheduleConversationRefresh()
          },
          onError: (error) => {
            console.warn('会话实时监听失败：', error)
            this.stopRealtimeWatch()
            if (!this.hasLoadedConversations) {
              this.loadConversations(false)
            }
          }
        }))
    } catch (error) {
      console.warn('启动会话实时监听失败：', error)
      this.stopRealtimeWatch()
      if (!this.hasLoadedConversations) {
        this.loadConversations(false)
      }
    }
  },

  stopRealtimeWatch() {
    this.realtimeWatchers.forEach((watcher) => {
      if (watcher && typeof watcher.close === 'function') {
        watcher.close()
      }
    })
    this.realtimeWatchers = []
  },

  scheduleConversationRefresh() {
    this.clearRefreshTimer()
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      this.loadConversations(false)
    }, WATCH_REFRESH_DELAY)
  },

  clearRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  },

  /** 打开某个会话。 */
  openConversation(e) {
    if (!this.data.canUseMessage) return
    const conversationId = e.currentTarget.dataset.id
    const peerOpenid = e.currentTarget.dataset.peerOpenid || ''
    if (!conversationId) return
    wx.navigateTo({
      url: `/pages/chat/chat?conversationId=${conversationId}&peerOpenid=${encodeURIComponent(peerOpenid)}`
    })
  },

  /** 长按删除会话仅隐藏前端列表，不改动云数据库。 */
  deleteConversation(e) {
    if (!this.data.canUseMessage) return
    const groupId = e.currentTarget.dataset.groupId || ''
    if (!groupId) return

    wx.showModal({
      title: '删除会话',
      content: '仅从当前列表隐藏这条会话，云端聊天记录不会被删除。',
      confirmText: '删除',
      confirmColor: '#e34d59',
      success: (res) => {
        if (!res.confirm) return
        const hiddenIds = this.getHiddenGroupIds()
        this.saveHiddenGroupIds([...hiddenIds, groupId])
        const conversations = this.data.conversations.filter((item) => item._id !== groupId)
        this.setData({ conversations })
        this.saveConversationCache(conversations)
        wx.showToast({ title: '已从列表隐藏', icon: 'none' })
      }
    })
  }
})

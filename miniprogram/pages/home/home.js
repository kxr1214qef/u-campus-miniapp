const app = getApp()
const {
  categoryIllustrations,
  defaultAvatar,
  defaultGoodsCover,
  getDisplayCategory,
  isCategoryMatch
} = require('../../config/index')
const { listGoods } = require('../../utils/api')
const { formatRelativeTime } = require('../../utils/time')
const { resolveDisplayUrlList } = require('../../utils/file')

const PAGE_SIZE = 20
const LIST_TYPE_OPTIONS = [
  { type: 'idle', text: '最新闲置' },
  { type: 'wanted', text: '需求列表' }
]
const LIST_COPY = {
  idle: {
    title: '最新闲置',
    unit: '件校园闲置正在展示中',
    refreshIdle: '下拉页面可刷新最新闲置',
    refreshing: '正在刷新最新闲置...',
    refreshed: '刷新完成，已更新最新闲置',
    emptyTitle: '暂时没有匹配的闲置',
    emptyDesc: '换个关键词试试，或者点击底部“发布”按钮，成为第一位上架的同学。'
  },
  wanted: {
    title: '最新需求',
    unit: '条校园需求正在展示中',
    refreshIdle: '下拉页面可刷新最新需求',
    refreshing: '正在刷新最新需求...',
    refreshed: '刷新完成，已更新最新需求',
    emptyTitle: '暂时没有匹配的需求',
    emptyDesc: '换个关键词试试，或者点击底部“发布”按钮，说说你想收什么。'
  }
}

function pickCover(item = {}) {
  if (Array.isArray(item.images) && item.images.length) return item.images[0]
  return item.cover || item.imageUrl || item.image || ''
}

function normalizeTags(tags = []) {
  return Array.isArray(tags) ? tags.filter(Boolean) : []
}

function getLocationText(item = {}) {
  const location = item.location || {}
  return String(
    item.locationName ||
    location.name ||
    item.locationAddress ||
    location.address ||
    ''
  ).trim()
}

function getLocationSearchText(item = {}) {
  const location = item.location || {}
  return [
    item.locationName,
    location.name,
    item.locationAddress,
    location.address
  ].filter(Boolean).join(' ')
}

function getListCopy(type = 'idle') {
  return LIST_COPY[type] || LIST_COPY.idle
}

function getGoodsKey(type = 'idle') {
  return type === 'wanted' ? 'wantedGoods' : 'idleGoods'
}

function getHasMoreKey(type = 'idle') {
  return type === 'wanted' ? 'wantedHasMore' : 'idleHasMore'
}

function getLoadedKey(type = 'idle') {
  return type === 'wanted' ? 'wantedLoaded' : 'idleLoaded'
}

function mergeUniqueGoods(oldList = [], newList = []) {
  const map = new Map()
  oldList.concat(newList).forEach((item) => {
    if (item && item._id && !map.has(item._id)) {
      map.set(item._id, item)
    }
  })
  return Array.from(map.values())
}

function splitWaterfall(list = []) {
  return {
    leftList: list.filter((item, index) => index % 2 === 0),
    rightList: list.filter((item, index) => index % 2 === 1)
  }
}

Page({
  data: {
    categoryCards: categoryIllustrations,
    listTypeOptions: LIST_TYPE_OPTIONS,
    activeListType: 'idle',
    listCopy: getListCopy('idle'),
    activeCategory: '全部',
    keyword: '',
    greetingName: '同学',
    allGoods: [],
    idleGoods: [],
    wantedGoods: [],
    goodsList: [],
    leftList: [],
    rightList: [],
    idleLoaded: false,
    wantedLoaded: false,
    idleHasMore: true,
    wantedHasMore: true,
    activeHasMore: true,
    loading: false,
    loadingMore: false,
    refreshTip: getListCopy('idle').refreshIdle,
    defaultAvatar,
    defaultGoodsCover
  },

  onLoad() {
    this.loadPageData()
  },

  onShow() {
    this.syncTabBar()
    this.updateGreeting()
    if (app.globalData.homeNeedsRefresh) {
      const nextType = app.globalData.homeRefreshType || this.data.activeListType
      app.globalData.homeNeedsRefresh = false
      this.switchListType(nextType, false)
      this.setData({ refreshTip: '发布成功，正在更新列表...' })
      this.loadGoods(false, { append: false }).then(() => {
        this.setData({ refreshTip: '列表已更新' })
      })
    }
  },

  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/home/home' })
      if (typeof tabBar.refreshUnreadCount === 'function') {
        tabBar.refreshUnreadCount()
      }
    }
  },

  async onPullDownRefresh() {
    this.setData({ refreshTip: this.data.listCopy.refreshing })
    try {
      await this.loadGoods(false, { append: false })
      this.setData({ refreshTip: this.data.listCopy.refreshed })
      wx.showToast({ title: '已刷新', icon: 'success' })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    this.loadMoreGoods()
  },

  async loadPageData(showLoading = true) {
    this.updateGreeting()
    await this.loadGoods(showLoading, { append: false })
  },

  updateGreeting() {
    const profile = app.globalData.userProfile || {}
    this.setData({ greetingName: profile.nickName || '同学' })
  },

  getStoredGoods(type = this.data.activeListType) {
    return this.data[getGoodsKey(type)] || []
  },

  isTypeLoaded(type = this.data.activeListType) {
    return !!this.data[getLoadedKey(type)]
  },

  getExcludeIds(type = this.data.activeListType) {
    return this.getStoredGoods(type).map((item) => item._id).filter(Boolean)
  },

  setTypeGoods(type, list, hasMore) {
    const isActive = type === this.data.activeListType
    const updateData = {
      [getGoodsKey(type)]: list,
      [getHasMoreKey(type)]: !!hasMore,
      [getLoadedKey(type)]: true
    }
    if (isActive) {
      updateData.allGoods = list
      updateData.activeHasMore = !!hasMore
    }
    this.setData(updateData)
    if (isActive) this.applyFilters()
  },

  async fetchGoodsPage(type, excludeIds = []) {
    const res = await listGoods({
      publishType: type,
      pageSize: PAGE_SIZE,
      excludeIds
    })
    const list = await this.formatGoodsList(res.list || [])
    return {
      list,
      hasMore: res.hasMore !== undefined ? !!res.hasMore : list.length >= PAGE_SIZE
    }
  },

  async loadGoods(showLoading = true, options = {}) {
    const append = !!options.append
    const type = this.data.activeListType
    if (append) {
      if (this.data.loadingMore || !this.data.activeHasMore) return
      this.setData({ loadingMore: true })
    } else if (showLoading) {
      this.setData({ loading: true })
    }

    try {
      const currentList = append ? this.getStoredGoods(type) : []
      const res = await this.fetchGoodsPage(type, append ? this.getExcludeIds(type) : [])
      const nextList = append ? mergeUniqueGoods(currentList, res.list) : res.list
      this.setTypeGoods(type, nextList, res.hasMore)
    } catch (error) {
      console.error('首页列表加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({
        loading: false,
        loadingMore: false
      })
    }
  },

  async loadMoreGoods() {
    await this.loadGoods(false, { append: true })
  },

  async formatGoodsList(rawList = []) {
    const coverRefs = rawList.map((item) => pickCover(item))
    const avatarRefs = rawList.map((item) => item.ownerAvatarUrl || '')
    const [covers, avatars] = await Promise.all([
      resolveDisplayUrlList(coverRefs, ''),
      resolveDisplayUrlList(avatarRefs, defaultAvatar)
    ])

    return rawList.map((item, index) => {
      const tags = normalizeTags(item.tags)
      return {
        ...item,
        tags,
        displayCategory: getDisplayCategory(item.category, tags),
        cover: covers[index] || '',
        ownerAvatarUrl: avatars[index] || defaultAvatar,
        locationText: getLocationText(item),
        timeText: formatRelativeTime(item.createdAt),
        priceText: item.publishType === 'wanted' ? `预算 ￥${item.price}` : `￥${item.price}`
      }
    })
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value || '' })
    this.applyFilters()
  },

  clearSearch() {
    this.setData({ keyword: '' })
    this.applyFilters()
  },

  onSelectCategory(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ activeCategory: category })
    this.applyFilters()
  },

  onSwitchListType(e) {
    const targetType = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.type
      : ''
    const nextType = targetType || (this.data.activeListType === 'wanted' ? 'idle' : 'wanted')
    if (nextType === this.data.activeListType) return
    this.switchListType(nextType)
  },

  switchListType(type, shouldAutoLoad = true) {
    const nextType = type === 'wanted' ? 'wanted' : 'idle'
    const allGoods = this.getStoredGoods(nextType)
    const listCopy = getListCopy(nextType)
    this.setData({
      activeListType: nextType,
      listCopy,
      allGoods,
      activeHasMore: !!this.data[getHasMoreKey(nextType)],
      refreshTip: listCopy.refreshIdle
    })
    this.applyFilters()
    if (shouldAutoLoad && !this.isTypeLoaded(nextType)) {
      this.loadGoods(false, { append: false })
    }
  },

  applyFilters() {
    const { allGoods, activeCategory, keyword } = this.data
    const loweredKeyword = String(keyword || '').trim().toLowerCase()
    const goodsList = allGoods.filter((item) => {
      const categoryPass = isCategoryMatch(item.category, activeCategory, item.tags)
      if (!categoryPass) return false
      if (!loweredKeyword) return true
      const haystack = [
        item.title,
        item.displayCategory,
        item.category,
        ...(item.tags || []),
        item.description,
        getLocationSearchText(item)
      ].join(' ').toLowerCase()
      return haystack.includes(loweredKeyword)
    })
    this.setData({
      goodsList,
      ...splitWaterfall(goodsList)
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  }
})

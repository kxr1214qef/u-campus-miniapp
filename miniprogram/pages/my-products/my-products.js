const { listMyGoods, updateGoodsStatus, deleteMyGoods } = require('../../utils/api')
const { formatRelativeTime } = require('../../utils/time')
const { defaultGoodsCover, getDisplayCategory } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')
const { resolveDisplayUrlList } = require('../../utils/file')

const PUBLISH_TYPE_OPTIONS = [
  { type: 'idle', text: '闲置' },
  { type: 'wanted', text: '需求' }
]
const PAGE_COPY = {
  idle: {
    title: '我发布的闲置',
    subtitle: '这里展示你的闲置发布记录，方便你管理在售状态，也支持直接删除。',
    emptyTitle: '你还没有发布闲置',
    emptyDesc: '去底部中间的发布按钮试试，发布第一件闲置吧。'
  },
  wanted: {
    title: '我发布的需求',
    subtitle: '这里展示你的需求发布记录，方便你管理需求状态，也支持直接删除。',
    emptyTitle: '你还没有发布需求',
    emptyDesc: '去发布页切换到“我想收”，说说你想收什么。'
  }
}

function pickCover(item = {}) {
  if (Array.isArray(item.images) && item.images.length) return item.images[0]
  return item.cover || item.imageUrl || item.image || ''
}

function normalizePublishType(item = {}) {
  return item.publishType === 'wanted' || item.type === 'wanted' ? 'wanted' : 'idle'
}

function getPageCopy(type = 'idle') {
  return type === 'wanted' ? PAGE_COPY.wanted : PAGE_COPY.idle
}

function buildStatusText(item = {}) {
  const type = normalizePublishType(item)
  if (item.status === 'on') return type === 'wanted' ? '需求中' : '在售中'
  if (item.status === 'sold') return type === 'wanted' ? '已完成' : '已售出'
  return '已下架'
}

function buildActionText(item = {}) {
  const type = normalizePublishType(item)
  if (item.status === 'on') return type === 'wanted' ? '完成' : '已售'
  return type === 'wanted' ? '重开' : '上架'
}

function splitWaterfall(list = []) {
  return {
    leftList: list.filter((item, index) => index % 2 === 0),
    rightList: list.filter((item, index) => index % 2 === 1)
  }
}

Page({
  data: {
    publishTypeOptions: PUBLISH_TYPE_OPTIONS,
    activePublishType: 'idle',
    pageCopy: getPageCopy('idle'),
    idleList: [],
    wantedList: [],
    list: [],
    leftList: [],
    rightList: [],
    loading: false,
    defaultGoodsCover
  },

  onLoad() {
    this.loadMyGoods()
  },

  onShow() {
    this.loadMyGoods(false)
  },

  async loadMyGoods(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await listMyGoods()
      const rawList = res.list || []
      const covers = await resolveDisplayUrlList(rawList.map((item) => pickCover(item)), '')
      const formatted = rawList.map((item, index) => {
        const publishType = normalizePublishType(item)
        const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : []
        return {
          ...item,
          publishType,
          tags,
          displayCategory: getDisplayCategory(item.category, tags),
          cover: covers[index] || '',
          timeText: formatRelativeTime(item.createdAt),
          priceText: publishType === 'wanted' ? `预算 ￥${item.price}` : `￥${item.price}`,
          statusText: buildStatusText(item),
          actionText: buildActionText(item)
        }
      })
      const idleList = formatted.filter((item) => item.publishType !== 'wanted')
      const wantedList = formatted.filter((item) => item.publishType === 'wanted')
      const list = this.data.activePublishType === 'wanted' ? wantedList : idleList
      this.setData({
        idleList,
        wantedList,
        list,
        ...splitWaterfall(list)
      })
    } catch (error) {
      console.error('我的发布加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onSwitchPublishType(e) {
    const type = this.data.activePublishType === 'wanted' ? 'idle' : 'wanted'
    const list = type === 'wanted' ? this.data.wantedList : this.data.idleList
    this.setData({
      activePublishType: type,
      pageCopy: getPageCopy(type),
      list,
      ...splitWaterfall(list)
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  async toggleStatus(e) {
    const { id, status, publishType } = e.currentTarget.dataset
    const nextStatus = status === 'on' ? 'sold' : 'on'
    try {
      wx.showLoading({ title: '处理中', mask: true })
      await updateGoodsStatus(id, nextStatus)
      wx.hideLoading()
      wx.showToast({
        title: nextStatus === 'on'
          ? (publishType === 'wanted' ? '已重新展示' : '已重新上架')
          : (publishType === 'wanted' ? '已标记完成' : '已标记已售'),
        icon: 'success'
      })
      this.loadMyGoods(false)
    } catch (error) {
      wx.hideLoading()
      console.error('更新状态失败：', error)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  deleteGoods(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '确认删除',
      content: '删除后发布内容、相关会话和消息都会一起移除，且无法恢复。',
      confirmColor: '#c85735',
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: '删除中', mask: true })
          await deleteMyGoods(id)
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadMyGoods(false)
        } catch (error) {
          wx.hideLoading()
          console.error('删除发布失败：', error)
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})

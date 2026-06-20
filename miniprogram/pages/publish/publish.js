/**
 * 发布页逻辑。
 * 作用：上传商品图片、填写商品信息并调用云函数发布。
 */
const app = getApp()
const { categoryIllustrations, categoryTagMap, defaultTagOptions } = require('../../config/index')
const { createGoods } = require('../../utils/api')
const { uploadFileToCloud } = require('../../utils/file')
const { requireLogin, buildLoginUrl } = require('../../utils/auth')

const MAX_PRICE = 99999
const MAX_TITLE_LENGTH = 40
const MAX_DESCRIPTION_LENGTH = 300
const DEFAULT_TAG_TITLE = '4. 补充标签（选填）'
const BOOK_TAG_TITLE = '4. 书籍标签（选填）'
const DEFAULT_TAG_HINT = '标签可不选，发布后买家依旧可以通过分类和标题找到商品。'
const BOOK_TAG_HINT = '教材资料建议补充标签，买家会更快找到你。'
const PUBLISH_TYPE_OPTIONS = [
  { type: 'idle', text: '我想卖' },
  { type: 'wanted', text: '我想收' }
]
const PUBLISH_COPY = {
  idle: {
    title: '发布一件闲置',
    subtitle: '不做站内交易，只帮助同学们更轻松地展示物品、私信沟通和线下约定位置。',
    imageLabel: '1. 上传商品图片',
    imageHint: '支持拍照或从相册选择，最多 3 张。',
    imageButton: '添加图片',
    titleLabel: '2. 商品名称',
    titlePlaceholder: '例如：高数教材 / 考研资料 / 无线鼠标',
    categoryLabel: '3. 商品分类',
    descriptionLabel: '5. 发布说明',
    descriptionPlaceholder: '补充商品成色、购买时间、转手原因、线下沟通时间等',
    priceLabel: '7. 期望价格',
    pricePlaceholder: '例如：25',
    submitText: '确认发布',
    successTitle: '发布成功'
  },
  wanted: {
    title: '发布一条需求',
    subtitle: '告诉大家你想收什么，方便有闲置的同学看到后主动私信你。',
    imageLabel: '1. 上传参考图片',
    imageHint: '可以放参考图、截图或物品样式，最多 3 张。',
    imageButton: '添加参考图',
    titleLabel: '2. 需求名称',
    titlePlaceholder: '例如：想收二手台灯 / 求购四级资料 / 收一辆自行车',
    categoryLabel: '3. 需求分类',
    descriptionLabel: '5. 需求说明',
    descriptionPlaceholder: '补充想要的型号、成色、预算范围、可面交时间等',
    priceLabel: '7. 预算价格',
    pricePlaceholder: '例如：50',
    submitText: '确认发布需求',
    successTitle: '需求已发布'
  }
}
function getPublishCopy(type = 'idle') {
  return PUBLISH_COPY[type] || PUBLISH_COPY.idle
}

/** 把已选标签数组转成映射表，方便 WXML 判断 active 状态。 */
function buildTagMap(tags = []) {
  return tags.reduce((acc, item) => {
    acc[item] = true
    return acc
  }, {})
}

/** 格式化价格输入，只保留数字和最多两位小数。 */
function normalizePriceInput(rawValue = '') {
  const text = String(rawValue || '').replace(/[^\d.]/g, '')
  const parts = text.split('.')
  const integerPart = (parts[0] || '').replace(/^0+(?=\d)/, '')
  if (parts.length <= 1) return integerPart
  const decimalPart = parts.slice(1).join('').slice(0, 2)
  return decimalPart ? `${integerPart || '0'}.${decimalPart}` : `${integerPart || '0'}.`
}

/** 校验最终提交价格。 */
function parsePrice(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) {
    throw new Error('请填写期望价格')
  }
  const price = Number(value)
  if (!Number.isFinite(price)) {
    throw new Error('价格格式不正确')
  }
  const normalized = Math.round(price * 100) / 100
  if (normalized <= 0) {
    throw new Error('价格必须大于 0')
  }
  if (normalized > MAX_PRICE) {
    throw new Error(`价格不能超过 ${MAX_PRICE}`)
  }
  return normalized
}

Page({
  data: {
    publishType: 'idle',
    publishTypeOptions: PUBLISH_TYPE_OPTIONS,
    copy: getPublishCopy('idle'),
    form: {
      title: '',
      description: '',
      price: '',
      category: '',
      tags: [],
      images: [],
      location: null
    },
    categoryCards: categoryIllustrations,
    tagOptions: defaultTagOptions,
    tagTitle: DEFAULT_TAG_TITLE,
    tagHint: DEFAULT_TAG_HINT,
    selectedTagsMap: {},
    imagePreviews: [],
    loginChecked: false,
    canPublish: false,
    uploading: false,
    choosingLocation: false,
    submitting: false
  },

  /** 页面显示时同步自定义 tabBar，并确认已登录后再允许发布。 */
  onShow() {
    this.syncTabBar()
    this.ensurePublishLogin(true)
  },

  onReady() {
    this.updateTagPanel(this.data.form.category)
  },

  /** 同步自定义 tabBar 的选中项。 */
  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/publish/publish' })
      if (typeof tabBar.refreshUnreadCount === 'function') {
        tabBar.refreshUnreadCount()
      }
    }
  },

  async ensurePublishLogin(showModal = true) {
    const canPublish = await requireLogin({
      title: '先登录再发布',
      content: '完善昵称并保存后，就可以发布校园闲置或需求。',
      from: 'publish',
      silent: !showModal
    })
    this.setData({
      loginChecked: true,
      canPublish
    })
    return canPublish
  },

  goLoginPage() {
    wx.navigateTo({ url: buildLoginUrl('publish') })
  },

  onSwitchPublishType(e) {
    const nextType = this.data.publishType === 'wanted' ? 'idle' : 'wanted'
    this.switchPublishType(nextType)
  },

  switchPublishType(type) {
    const nextType = type === 'wanted' ? 'wanted' : 'idle'
    if (nextType === this.data.publishType) return
    this.setData({
      publishType: nextType,
      copy: getPublishCopy(nextType)
    })
  },

  /** 商品标题输入。 */
  onTitleInput(e) {
    this.setData({ 'form.title': e.detail.value })
  },

  /** 商品描述输入。 */
  onDescriptionInput(e) {
    this.setData({ 'form.description': e.detail.value })
  },

  /** 价格输入，只保留数字和两位小数。 */
  onPriceInput(e) {
    this.setData({ 'form.price': normalizePriceInput(e.detail.value) })
  },

  /** 手动打开地图选择位置。 */
  async chooseLocation() {
    if (!(await this.ensurePublishLogin(true)) || this.data.choosingLocation) return
    this.setData({ choosingLocation: true })
    try {
      const res = await wx.chooseLocation()
      const name = String(res.name || '').trim()
      const address = String(res.address || '').trim()
      this.setData({
        'form.location': {
          name,
          address,
          latitude: res.latitude,
          longitude: res.longitude
        }
      })
    } catch (error) {
      const errMsg = String((error && error.errMsg) || '')
      if (errMsg.includes('cancel')) return
      console.error('选择位置失败：', error)
      wx.showToast({ title: '位置选择失败', icon: 'none' })
    } finally {
      this.setData({ choosingLocation: false })
    }
  },

  /** 清除已选择的位置。 */
  clearLocation() {
    this.setData({ 'form.location': null })
  },

  /** 选择商品分类并刷新可选标签。 */
  onSelectCategory(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ 'form.category': category })
    this.updateTagPanel(category)
  },

  /** 选择或取消标签，最多保留 5 个。 */
  onToggleTag(e) {
    const value = e.currentTarget.dataset.tag
    const tags = [...this.data.form.tags]
    const index = tags.indexOf(value)
    if (index > -1) {
      tags.splice(index, 1)
    } else {
      if (tags.length >= 5) {
        wx.showToast({ title: '最多选择 5 个标签', icon: 'none' })
        return
      }
      tags.push(value)
    }
    this.setData({
      'form.tags': tags,
      selectedTagsMap: buildTagMap(tags)
    })
  },

  /**
   * 选择并上传商品图片。
   * 修复点：form.images 保存云 fileID 用于提交，imagePreviews 保存本地临时图用于当前页面预览，避免 cloud:// 直接作为预览 src 造成空图。
   */
  async chooseImages() {
    if (!(await this.ensurePublishLogin(true))) return
    const currentCount = this.data.form.images.length
    if (currentCount >= 3) {
      wx.showToast({ title: '最多上传 3 张图片', icon: 'none' })
      return
    }
    try {
      const chooseRes = await wx.chooseMedia({
        count: 3 - currentCount,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const tempFiles = chooseRes.tempFiles || []
      if (!tempFiles.length) return

      this.setData({ uploading: true })
      wx.showLoading({ title: '上传中', mask: true })

      const uploaded = []
      const previews = []
      const uploadDir = this.data.publishType === 'wanted' ? 'demands' : 'goods'
      for (let i = 0; i < tempFiles.length; i += 1) {
        const file = tempFiles[i]
        const fileID = await uploadFileToCloud(file.tempFilePath, uploadDir)
        uploaded.push(fileID)
        previews.push(file.tempFilePath)
      }

      const images = [...this.data.form.images, ...uploaded]
      const imagePreviews = [...this.data.imagePreviews, ...previews]
      this.setData({
        'form.images': images,
        imagePreviews
      })
      wx.hideLoading()
    } catch (error) {
      wx.hideLoading()
      if (error && String(error.errMsg || '').includes('cancel')) return
      console.error('上传图片失败：', error)
      wx.showToast({ title: '图片上传失败', icon: 'none' })
    } finally {
      this.setData({ uploading: false })
    }
  },

  /** 删除某张已选图片，并同步删除提交 fileID 与页面预览图。 */
  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = [...this.data.form.images]
    const imagePreviews = [...this.data.imagePreviews]
    if (!Number.isInteger(index) || index < 0) return
    images.splice(index, 1)
    imagePreviews.splice(index, 1)
    const updateData = {
      'form.images': images,
      imagePreviews
    }
    this.setData(updateData)
  },

  /** 校验表单并提交发布。 */
  async submitGoods() {
    if (!(await this.ensurePublishLogin(true))) return
    const { form, submitting, publishType, copy } = this.data
    if (submitting) return
    const title = String(form.title || '').trim()
    const description = String(form.description || '').trim()
    if (!form.images.length) {
      wx.showToast({ title: '请至少上传 1 张图片', icon: 'none' })
      return
    }
    if (!title) {
      wx.showToast({ title: publishType === 'wanted' ? '请填写需求名称' : '请填写商品名称', icon: 'none' })
      return
    }
    if (title.length > MAX_TITLE_LENGTH) {
      wx.showToast({ title: `商品名称最多 ${MAX_TITLE_LENGTH} 字`, icon: 'none' })
      return
    }
    if (!form.category) {
      wx.showToast({ title: publishType === 'wanted' ? '请选择需求分类' : '请选择商品分类', icon: 'none' })
      return
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      wx.showToast({ title: `发布说明最多 ${MAX_DESCRIPTION_LENGTH} 字`, icon: 'none' })
      return
    }

    let price = 0
    try {
      price = parsePrice(form.price)
    } catch (error) {
      wx.showToast({ title: error.message || '价格格式不正确', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中', mask: true })
    try {
      await createGoods({
        title,
        description,
        price,
        category: form.category,
        tags: form.tags,
        images: form.images,
        location: form.location,
        publishType
      })

      wx.hideLoading()
      wx.showToast({ title: copy.successTitle, icon: 'success' })
      app.globalData.homeNeedsRefresh = true
      app.globalData.homeRefreshType = publishType
      this.resetForm()
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' })
      }, 700)
    } catch (error) {
      wx.hideLoading()
      console.error('发布失败：', error)
      wx.showToast({ title: error.message || '发布失败，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 发布成功后重置表单状态。 */
  resetForm() {
    this.setData({
      form: {
        title: '',
        description: '',
        price: '',
        category: '',
        tags: [],
        images: [],
        location: null
      },
      tagOptions: defaultTagOptions,
      tagTitle: DEFAULT_TAG_TITLE,
      tagHint: DEFAULT_TAG_HINT,
      selectedTagsMap: {},
      imagePreviews: []
    })
  },

  /** 根据分类获取标签候选项。 */
  getTagOptionsByCategory(category) {
    if (category && categoryTagMap[category]) {
      return categoryTagMap[category]
    }
    return defaultTagOptions
  },

  /** 根据分类获取标签模块标题。 */
  getTagTitle(category) {
    return category === '教材资料' ? BOOK_TAG_TITLE : DEFAULT_TAG_TITLE
  },

  /** 根据分类获取标签模块提示。 */
  getTagHint(category) {
    return category === '教材资料' ? BOOK_TAG_HINT : DEFAULT_TAG_HINT
  },

  /** 更新标签面板，并移除不属于当前分类的已选标签。 */
  updateTagPanel(category) {
    const options = this.getTagOptionsByCategory(category)
    const keptTags = (this.data.form.tags || []).filter((tag) => options.includes(tag))
    this.setData({
      tagOptions: options,
      tagTitle: this.getTagTitle(category),
      tagHint: this.getTagHint(category),
      'form.tags': keptTags,
      selectedTagsMap: buildTagMap(keptTags)
    })
  }
})

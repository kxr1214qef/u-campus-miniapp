/**
 * 全局配置文件。
 * 作用：集中管理云环境 ID、商品分类、标签、工具箱内容等常量。
 * 原理：页面只引用这里的配置，后续要换学校、换标签、换主题时改一处即可生效。
 */
const publishCategories = [
  '教材资料',
  '数码设备',
  '宿舍好物',
  '骑行运动',
  '美妆穿搭',
  '生活日用'
]

const categories = ['全部', ...publishCategories]

const categoryIllustrations = [
  {
    name: '教材资料',
    key: 'books',
    label: '学习资料小摊'
  },
  {
    name: '数码设备',
    key: 'digital',
    label: '校园数码小铺'
  },
  {
    name: '宿舍好物',
    key: 'dorm',
    label: '寝室桌面一角'
  },
  {
    name: '骑行运动',
    key: 'sport',
    label: '骑行运动摊'
  },
  {
    name: '美妆穿搭',
    key: 'beauty',
    label: '穿搭小铺'
  },
  {
    name: '生活日用',
    key: 'daily',
    label: '日用杂货摊'
  }
]

const categoryTagMap = {
  教材资料: [
    '教材',
    '参考书',
    '实验报告',
    '考研资料',
    '期末真题',
    '课堂笔记',
    '习题答案',
    '竞赛资料',
    '四六级',
    '雅思托福',
    '编程资料',
    '专业课资料'
  ],
  数码设备: ['手机', '平板', '电脑', '耳机', '键鼠', '充电器', '移动硬盘', '显示器', '相机', '数码配件'],
  宿舍好物: ['台灯', '收纳', '床帘', '小桌板', '风扇', '插排', '置物架', '宿舍装饰', '宿舍用品', '桌游'],
  骑行运动: ['自行车', '电动车', '滑板', '车锁', '头盔', '球拍', '球类', '篮球', '运动鞋', '瑜伽垫', '健身小物'],
  美妆穿搭: ['化妆品', '护肤品', '香水', '饰品', '包包', '衣物', '鞋子', '鞋帽', '穿搭配件', '小镜子', '卷发棒', '美甲灯'],
  生活日用: ['杯子', '雨伞', '纸巾', '小家电', '衣架', '杂物', '寝室常用品', '几乎全新', '电影票', '演出票', '校园卡券']
}

const defaultTagOptions = ['可议价', '校内自提', '当面验货']

const categoryAliasMap = {
  书籍教材: '教材资料',
  数码电子: '数码设备',
  服饰鞋包: '美妆穿搭',
  美妆个护: '美妆穿搭',
  文体乐器: '生活日用',
  乐器文娱: '生活日用',
  票券服务: '生活日用',
  票券卡券: '生活日用',
  其他: '生活日用',
  宿舍好物: '宿舍好物',
  运动器材: '骑行运动'
}

const categorySearchAliasMap = {
  教材资料: ['教材资料', '书籍教材'],
  数码设备: ['数码设备', '数码电子'],
  宿舍好物: ['宿舍好物'],
  骑行运动: ['骑行运动', '文体乐器', '运动器材', '乐器文娱'],
  美妆穿搭: ['美妆穿搭', '服饰鞋包', '美妆个护'],
  生活日用: ['生活日用', '票券服务', '票券卡券', '其他']
}

const tagCategoryMap = {
  台灯: '宿舍好物',
  收纳: '宿舍好物',
  床帘: '宿舍好物',
  小桌板: '宿舍好物',
  风扇: '宿舍好物',
  插排: '宿舍好物',
  置物架: '宿舍好物',
  宿舍装饰: '宿舍好物',
  宿舍用品: '宿舍好物',
  桌游: '宿舍好物',
  球拍: '骑行运动',
  球类: '骑行运动',
  健身: '骑行运动',
  篮球: '骑行运动',
  运动鞋: '骑行运动',
  瑜伽垫: '骑行运动',
  健身小物: '骑行运动',
  吉他: '生活日用',
  键盘: '生活日用',
  自行车: '骑行运动',
  电动车: '骑行运动',
  滑板: '骑行运动',
  车锁: '骑行运动',
  头盔: '骑行运动',
  电影票: '生活日用',
  演出票: '生活日用',
  校园卡券: '生活日用',
  化妆品: '美妆穿搭',
  护肤品: '美妆穿搭',
  香水: '美妆穿搭',
  饰品: '美妆穿搭',
  配饰: '美妆穿搭',
  包包: '美妆穿搭',
  衣物: '美妆穿搭',
  鞋子: '美妆穿搭',
  鞋帽: '美妆穿搭',
  穿搭配件: '美妆穿搭',
  小镜子: '美妆穿搭',
  卷发棒: '美妆穿搭',
  美甲灯: '美妆穿搭'
}

function normalizeTags(tags = []) {
  if (Array.isArray(tags)) return tags
  if (typeof tags === 'string' && tags) return [tags]
  return []
}

function getDisplayCategory(category, tags = []) {
  const tagList = normalizeTags(tags)
  const tagMatchedCategory = tagList.map((tag) => tagCategoryMap[tag]).find(Boolean)
  if (tagMatchedCategory) return tagMatchedCategory
  if (publishCategories.includes(category)) return category
  return categoryAliasMap[category] || category || ''
}

function getCategorySearchNames(category) {
  if (category === '全部') return ['全部']
  return categorySearchAliasMap[category] || [category]
}

function isCategoryMatch(itemCategory, selectedCategory, tags = []) {
  if (!selectedCategory || selectedCategory === '全部') return true
  const displayCategory = getDisplayCategory(itemCategory, tags)
  if (displayCategory === selectedCategory) return true
  if (publishCategories.includes(displayCategory)) return false
  return getCategorySearchNames(selectedCategory).includes(itemCategory)
}

module.exports = {
  envId: 'cloud1-5gljnjys56b0d21a',
  theme: {
    primary: '#f6df8b',
    secondary: '#cfe9c9',
    accent: '#fffdf4'
  },
  /**
   * 前端保留字段。
   * 注意：真正的管理员权限在 cloudfunctions/userManager/index.js 的 adminOpenids 中校验，
   * 修改管理员后需要重新部署 userManager 云函数。
   */
  adminOpenids: [],
  categories,
  publishCategories,
  categoryIllustrations,
  categoryTagMap,
  categoryAliasMap,
  categorySearchAliasMap,
  defaultTagOptions,
  getDisplayCategory,
  getCategorySearchNames,
  isCategoryMatch,
  toolboxCards: [
    {
      id: 'calendar',
      title: '校历',
      desc: '校历、考试周、放假安排。',
      detail: '建议把学校官方校历、考试周安排、选课时间整理后写入这里，或者改造成从云数据库读取。'
    },
    {
      id: 'repair',
      title: '报修信息',
      desc: '报修流程、电话、值班时间。',
      detail: '当前为静态占位模块。你可以把宿舍管理员电话、报修二维码、流程说明写进 config/index.js。'
    },
    {
      id: 'express',
      title: '快递点信息',
      desc: '快递点营业时间和位置。',
      detail: '推荐补充：菜鸟驿站地址、营业时间、晚高峰建议时段、丢件处理方式。'
    },
    {
      id: 'notice',
      title: '校园公告',
      desc: '二手交易须知、学校生活提醒等。',
      detail: '当前小程序不做站内支付，建议在这里放置“谨防诈骗、当面验货、校内交易优先”等提醒。'
    }
  ],
  defaultAvatar: '/images/avatar-default.png',
  defaultGoodsCover: '/images/goods-placeholder.png'
}

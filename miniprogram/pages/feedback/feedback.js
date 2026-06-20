const { submitFeedback } = require('../../utils/api')
const { goBackOrSwitchTab } = require('../../utils/helper')

const MAX_CONTENT_LENGTH = 500

Page({
  data: {
    form: {
      content: ''
    },
    contentLength: 0,
    maxContentLength: MAX_CONTENT_LENGTH,
    submitting: false
  },

  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  },

  onContentInput(e) {
    const content = String(e.detail.value || '').slice(0, MAX_CONTENT_LENGTH)
    this.setData({
      'form.content': content,
      contentLength: content.length
    })
  },

  validateForm() {
    if (!String(this.data.form.content || '').trim()) {
      wx.showToast({ title: '先写一点反馈内容吧', icon: 'none' })
      return false
    }
    return true
  },

  async submitFeedbackForm() {
    if (this.data.submitting || !this.validateForm()) return
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交', mask: true })
    try {
      await submitFeedback(this.data.form)
      wx.hideLoading()
      wx.showToast({ title: '收到啦，感谢你的建议', icon: 'none', duration: 1800 })
      setTimeout(() => {
        wx.navigateBack()
      }, 900)
    } catch (error) {
      wx.hideLoading()
      console.error('提交反馈失败：', error)
      wx.showToast({ title: '提交失败，稍后再试试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})

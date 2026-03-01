const express = require('express')
const router = express.Router()
const adminService = require('./admin.service')
const paymentService = require('../payment/payment.service')
const db = require('../../config/database')

let adminSessions = {}

router.post('/login', (req, res) => {
  const { password } = req.body
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
  if (password === ADMIN_PASSWORD) {
    const sessionId = require('uuid').v4()
    adminSessions[sessionId] = { loggedIn: true, createdAt: Date.now() }
    res.json({ success: true, sessionId })
  } else {
    res.status(401).json({ success: false, error: 'Senha incorreta' })
  }
})

router.get('/data', async (req, res) => {
  const houseBalance = await paymentService.getHouseBalance()
  const transactions = await paymentService.getAllTransactions()
  const settings = await adminService.getAllSettings()
  const roomsResult = await db.query(`SELECT * FROM rooms WHERE ended = FALSE`)
  res.json({ houseBalance, rooms: roomsResult.rows, transactions, settings })
})

router.get('/settings', async (req, res) => {
  const settings = await adminService.getAllSettings()
  res.json({
    monetizationEnabled: settings.monetization_enabled === 'true',
    entryFee: parseFloat(settings.entry_fee),
    prize: parseFloat(settings.prize),
    houseFee: parseFloat(settings.house_fee)
  })
})

router.post('/settings', async (req, res) => {
  const { sessionId, monetizationEnabled } = req.body
  if (!adminSessions[sessionId]) {
    return res.status(401).json({ success: false, error: 'Não autorizado' })
  }
  await adminService.updateSetting('monetization_enabled', monetizationEnabled ? 'true' : 'false')
  res.json({ success: true, settings: { monetizationEnabled } })
})

module.exports = router
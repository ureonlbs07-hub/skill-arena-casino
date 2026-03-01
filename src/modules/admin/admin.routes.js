const express = require('express')
const router = express.Router()
const adminService = require('./admin.service')
const paymentService = require('../payment/payment.service')
const db = require('../../config/database')

// ============================================
// 🔥 LOGIN (Gera token simples)
// ============================================
router.post('/login', (req, res) => {
  const { password } = req.body
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
  
  if (password === ADMIN_PASSWORD) {
    const token = require('uuid').v4()
    res.json({ success: true, token })
  } else {
    res.status(401).json({ success: false, error: 'Senha incorreta' })
  }
})

// ============================================
// 🔥 DADOS DO DASHBOARD
// ============================================
router.get('/data', async (req, res) => {
  try {
    const houseBalance = await paymentService.getHouseBalance()
    const transactions = await paymentService.getAllTransactions()
    const settings = await adminService.getAllSettings()
    const roomsResult = await db.query(`SELECT * FROM rooms WHERE ended = FALSE`)
    
    res.json({ 
      houseBalance, 
      rooms: roomsResult.rows, 
      transactions, 
      settings 
    })
  } catch (error) {
    console.error('❌ Erro /api/admin/data:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// 🔥 SETTINGS
// ============================================
router.get('/settings', async (req, res) => {
  const settings = await adminService.getAllSettings()
  res.json({
    monetizationEnabled: settings.monetization_enabled === 'true',
    entryFee: parseFloat(settings.entry_fee),
    prize: parseFloat(settings.prize),
    houseFee: parseFloat(settings.house_fee)
  })
})

// ✅ CORRIGIDO: Verificar token em vez de sessão em memória
router.post('/settings', async (req, res) => {
  try {
    const { token, monetizationEnabled } = req.body
    
    // ✅ Verificar se token existe (básico)
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token não enviado' })
    }
    
    // ✅ Atualizar setting
    await adminService.updateSetting('monetization_enabled', monetizationEnabled ? 'true' : 'false')
    
    res.json({ success: true, settings: { monetizationEnabled } })
  } catch (error) {
    console.error('❌ Erro /api/admin/settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

module.exports = router
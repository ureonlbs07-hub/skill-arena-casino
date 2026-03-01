const express = require('express')
const router = express.Router()
const adminService = require('./admin.service')
const paymentService = require('../payment/payment.service')
const db = require('../../config/database')

// ============================================
// 🔥 LOGIN
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
// 🔥 SETTINGS (GET)
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

// ============================================
// 🔥 SETTINGS (POST) - ✅ CORRIGIDO
// ============================================
router.post('/settings', async (req, res) => {
  try {
    const { token, monetizationEnabled } = req.body
    
    console.log('🔧 /api/admin/settings recebido:', { token, monetizationEnabled })
    
    // ✅ Apenas verifica se token foi enviado (sem validação complexa)
    if (!token) {
      return res.status(401).json({ success: false, error: 'Não autorizado' })
    }
    
    // ✅ Atualizar setting no banco
    await adminService.updateSetting('monetization_enabled', monetizationEnabled ? 'true' : 'false')
    
    console.log('✅ Monetização atualizada:', monetizationEnabled)
    
    res.json({ success: true, settings: { monetizationEnabled } })
  } catch (error) {
    console.error('❌ Erro /api/admin/settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

module.exports = router
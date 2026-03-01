const express = require('express')
const router = express.Router()
const paymentService = require('./payment.service')

// ✅ SIMPLIFICADO: Cria transação manual
router.post('/create', async (req, res) => {
  try {
    const { roomId, userId, amount, playerType } = req.body
    
    const result = await paymentService.createTransaction({
      roomId,
      userId,
      amount,
      playerType
    })
    
    res.json({
      success: true,
      transactionId: result.transactionId,
      pixKey: result.pixKey,
      pixCode: result.pixCode,
      amount: result.amount
    })
  } catch (error) {
    console.error('Erro ao criar transação:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ✅ SIMPLIFICADO: Verifica status (sempre retorna pending até admin confirmar)
router.get('/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params
    
    const result = await db.query(
      `SELECT * FROM transactions WHERE id = $1`,
      [transactionId]
    )
    
    if (result.rows.length === 0) {
      return res.json({ paid: false })
    }
    
    const transaction = result.rows[0]
    res.json({ 
      paid: transaction.status === 'completed',
      status: transaction.status
    })
  } catch (error) {
    res.status(500).json({ paid: false, error: error.message })
  }
})

// ✅ NOVO: Admin confirma pagamento manualmente
router.post('/confirm', async (req, res) => {
  try {
    const { transactionId } = req.body
    
    await paymentService.confirmPayment(transactionId)
    
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ✅ NOVO: Lista transações pendentes
router.get('/pending', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM transactions WHERE status = 'pending' ORDER BY created_at DESC`
    )
    res.json({ transactions: result.rows })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

module.exports = router
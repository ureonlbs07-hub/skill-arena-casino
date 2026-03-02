const express = require('express')
const router = express.Router()
const paymentService = require('./payment.service')
const db = require('../../config/database')

// ✅ Cria transação
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

// ✅ Verifica status da transação
router.get('/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params
    
    const result = await paymentService.getTransactionStatus(transactionId)
    
    res.json(result)
  } catch (error) {
    console.error('Erro ao verificar status:', error)
    res.status(500).json({ paid: false, status: 'error', error: error.message })
  }
})

// ✅ Admin confirma pagamento
router.post('/confirm', async (req, res) => {
  try {
    const { transactionId } = req.body
    
    await paymentService.confirmPayment(transactionId)
    
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ✅ Lista pagamentos pendentes
router.get('/pending', async (req, res) => {
  try {
    console.log('🔧 /api/payment/pending chamado')
    const transactions = await paymentService.getPendingPayments()
    console.log('📊 Pendentes encontrados:', transactions.length)
    res.json({ transactions })
  } catch (error) {
    console.error('Erro ao listar pendentes:', error)
    res.status(500).json({ success: false, error: error.message, transactions: [] })
  }
})

module.exports = router
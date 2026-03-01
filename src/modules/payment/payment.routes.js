const express = require('express')
const router = express.Router()
const paymentService = require('./payment.service')
const db = require('../../config/database')

router.post('/create', async (req, res) => {
  const { userId, roomId, playerType } = req.body
  if (!userId || !roomId) {
    return res.status(400).json({ success: false, error: 'Dados inválidos' })
  }
  try {
    const transaction = await paymentService.createTransaction(userId, roomId, 10.00, playerType)
    const pixData = await paymentService.generatePix(transaction.id, userId, roomId, playerType)
    res.json({
      success: true,
      transactionId: transaction.id,
      pixCode: pixData.pixCode,
      pixQRCode: pixData.pixQRCode,
      amount: 10.00,
      testMode: false
    })
  } catch (error) {
    console.error('❌ Erro ao criar PIX:', error)
    res.status(500).json({ success: false, error: 'Erro ao gerar PIX' })
  }
})

router.get('/status/:transactionId', async (req, res) => {
  const { transactionId } = req.params
  const result = await db.query(`SELECT status FROM transactions WHERE id = $1`, [transactionId])
  if (!result.rows[0]) {
    return res.status(404).json({ success: false, error: 'Transação não encontrada' })
  }
  res.json({
    success: true,
    status: result.rows[0].status,
    paid: result.rows[0].status === 'approved'
  })
})

module.exports = router
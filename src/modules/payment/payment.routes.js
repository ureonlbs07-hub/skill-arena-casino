const express = require('express')
const router = express.Router()
const paymentService = require('./payment.service')
const db = require('../../config/database')

let io = null

router.setIO = (socketIO) => {
  io = socketIO
  console.log('✅ IO inicializado nas rotas de pagamento')
}

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

// ✅ CORRIGIDO: Confirmar pagamento E notificar host se ambos pagaram
router.post('/confirm', async (req, res) => {
  try {
    const { transactionId } = req.body
    
    console.log('💰 Confirmando pagamento:', transactionId)
    console.log('📡 IO está definido:', io ? 'SIM' : 'NÃO')
    
    // 1. Confirmar pagamento no banco
    await paymentService.confirmPayment(transactionId)
    
    // 2. Buscar dados da transação
    const txResult = await db.query(
      `SELECT room_code FROM transactions WHERE id = $1`,
      [transactionId]
    )
    
    if (txResult.rows.length === 0) {
      console.log('❌ Transação não encontrada')
      return res.json({ success: false, error: 'Transação não encontrada' })
    }
    
    const roomCode = txResult.rows[0].room_code
    console.log('📊 Código da sala:', roomCode)
    
    // 3. Buscar sala do banco
    const roomResult = await db.query(
      `SELECT * FROM rooms WHERE code = $1`,
      [roomCode]
    )
    
    if (roomResult.rows.length === 0) {
      console.log('❌ Sala não encontrada')
      return res.json({ success: false, error: 'Sala não encontrada' })
    }
    
    const room = roomResult.rows[0]
    
    console.log('📊 host_id:', room.host_id)
    console.log('📊 guest_id:', room.guest_id)
    console.log('📊 host_paid:', room.host_paid)
    console.log('📊 guest_paid:', room.guest_paid)
    
    // 4. ✅ Se ambos pagaram, notificar host via socket
    if (room.host_paid && room.guest_paid && room.host_id && io) {
      console.log('✅ AMBOS PAGARAM!')
      console.log('✅ Emitindo bothPaid para host:', room.host_id)
      io.to(room.host_id).emit('bothPaid', { roomId: roomCode })
      console.log('✅ bothPaid emitido com sucesso!')
    } else {
      console.log('⏳ Aguardando ambos pagarem...')
      console.log('⏳ host_paid:', room.host_paid, 'guest_paid:', room.guest_paid)
      console.log('⏳ host_id:', room.host_id, 'io:', io ? 'definido' : 'NÃO DEFINIDO')
    }
    
    res.json({ success: true })
  } catch (error) {
    console.error('❌ Erro ao confirmar
const db = require('../../config/database')
const mercadopago = require('mercadopago')
const { v4: uuid } = require('uuid')

class PaymentService {
  async createTransaction(userId, roomId, amount, playerType) {
    const id = uuid()
    await db.query(
      `INSERT INTO transactions (id, user_id, room_code, amount, type, status)
       VALUES ($1, $2, $3, $4, 'entry', 'pending')`,
      [id, userId, roomId, amount]
    )
    return { id, userId, roomId, amount, status: 'pending' }
  }

  async generatePix(transactionId, userId, roomId, playerType) {
    const preference = {
      transaction_amount: 10.00,
      description: `Entrada Sala ${roomId} - ${playerType}`,
      payment_method_id: 'pix',
      payer: { email: `${userId}@skillarena.com` },
      external_reference: transactionId,
      metadata: { userId, roomId, playerType }
    }

    const result = await mercadopago.payment.create(preference)
    
    const pixCode = result.body?.point_of_interaction?.transaction_data?.ticket_url || ''
    const pixQRCode = result.body?.point_of_interaction?.transaction_data?.qr_code_base64 || ''

    await db.query(
      `UPDATE transactions SET pix_code = $1, pix_qr_code = $2, mp_payment_id = $3 WHERE id = $4`,
      [pixCode, pixQRCode, result.body.id, transactionId]
    )

    return { pixCode, pixQRCode, mpPaymentId: result.body.id }
  }

  async confirmPayment(transactionId) {
    await db.query(
      `UPDATE transactions SET status = 'approved', paid_at = NOW() WHERE id = $1`,
      [transactionId]
    )
    const result = await db.query(`SELECT * FROM transactions WHERE id = $1`, [transactionId])
    return result.rows[0]
  }

  async markRoomPaid(roomCode, playerType) {
    const field = playerType === 'host' ? 'host_paid' : 'guest_paid'
    await db.query(`UPDATE rooms SET ${field} = TRUE WHERE code = $1`, [roomCode])
  }

  async recordHouseFee(roomCode, amount) {
    const id = uuid()
    await db.query(
      `INSERT INTO transactions (id, room_code, amount, type, status)
       VALUES ($1, $2, $3, 'house_fee', 'approved')`,
      [id, roomCode, amount]
    )
  }

  async getHouseBalance() {
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'house_fee'`
    )
    return parseFloat(result.rows[0].total)
  }

  async getAllTransactions() {
    const result = await db.query(`SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100`)
    return result.rows
  }
}

module.exports = new PaymentService()
const db = require('../../config/database')
const { v4: uuidv4 } = require('uuid')

class PaymentService {
  async createTransaction(data) {
    const { roomId, userId, amount, playerType } = data
    
    // ✅ Gera UUID para o id
    const transactionId = uuidv4()
    
    const result = await db.query(
      `INSERT INTO transactions (id, user_id, room_code, amount, type, status) 
       VALUES ($1, $2, $3, $4, $5, 'pending') 
       RETURNING *`,
      [transactionId, userId, roomId, amount, 'entry']
    )
    
    console.log('✅ Transação criada:', result.rows[0].id)
    
    return {
      success: true,
      transactionId: result.rows[0].id,
      pixKey: 'SUA_CHAVE_PIX_AQUI',
      pixCode: '00020101021126330014br.gov.bcb.pix011122480649857520400005303986540510.005802BR5914GABRIEL A LIMA6009SAO PAULO62070503***63042EC2',
      amount: amount
    }
  }

  async markRoomPaid(roomCode, playerType) {
    const column = playerType === 'host' ? 'host_paid' : 'guest_paid'
    await db.query(
      `UPDATE rooms SET ${column} = TRUE WHERE code = $1`,
      [roomCode]
    )
  }

  async getHouseBalance() {
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'house_fee'`
    )
    return parseFloat(result.rows[0].total)
  }

  async getAllTransactions() {
    const result = await db.query(
      `SELECT * FROM transactions ORDER BY created_at DESC LIMIT 50`
    )
    return result.rows
  }

  async recordHouseFee(roomCode, amount) {
    const transactionId = uuidv4()
    await db.query(
      `INSERT INTO transactions (id, room_code, amount, type, status) 
       VALUES ($1, $2, $3, 'house_fee', 'completed')`,
      [transactionId, roomCode, amount]
    )
  }

  async confirmPayment(transactionId) {
    await db.query(
      `UPDATE transactions SET status = 'completed', paid_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [transactionId]
    )
    
    const result = await db.query(
      `SELECT room_code, user_id FROM transactions WHERE id = $1`,
      [transactionId]
    )
    
    if (result.rows.length > 0) {
      const { room_code } = result.rows[0]
      await this.markRoomPaid(room_code, 'host')
    }
  }

  async getPendingPayments() {
    const result = await db.query(
      `SELECT * FROM transactions WHERE status = 'pending' ORDER BY created_at DESC`
    )
    return result.rows
  }
}

module.exports = new PaymentService()
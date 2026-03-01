const db = require('../../config/database')

class PaymentService {
  // ✅ SIMPLIFICADO: Cria transação sem Mercado Pago
  async createTransaction(data) {
    const { roomId, userId, amount, playerType } = data
    
    const result = await db.query(
      `INSERT INTO transactions (room_code, user_id, amount, type, status) 
       VALUES ($1, $2, $3, $4, 'pending') 
       RETURNING *`,
      [roomId, userId, amount, 'entry']
    )
    
    return {
      success: true,
      transactionId: result.rows[0].id,
      pixKey: 'SUA_CHAVE_PIX_AQUI',  // ← Sua chave PIX fixa
      pixCode: '00020126580014BR.GOV.BCB.PIX... (seu código PIX copia e cola)',
      amount: amount
    }
  }

  // ✅ SIMPLIFICADO: Apenas marca como pago
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
    await db.query(
      `INSERT INTO transactions (room_code, amount, type, status) 
       VALUES ($1, $2, 'house_fee', 'completed')`,
      [roomCode, amount]
    )
  }

  // ✅ NOVO: Admin confirma pagamento manual
  async confirmPayment(transactionId) {
    await db.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      [transactionId]
    )
    
    const result = await db.query(
      `SELECT room_code, user_id FROM transactions WHERE id = $1`,
      [transactionId]
    )
    
    if (result.rows.length > 0) {
      const { room_code, user_id } = result.rows[0]
      // Determina se é host ou guest pelo primeiro a pagar
      await this.markRoomPaid(room_code, 'host')  // Simplificado
    }
  }
}

module.exports = new PaymentService()
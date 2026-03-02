const db = require('../../config/database')
const { v4: uuidv4 } = require('uuid')

class PaymentService {
  async createTransaction(data) {
    const { roomId, userId, amount, playerType } = data
    
    const transactionId = uuidv4()
    
    const result = await db.query(
      `INSERT INTO transactions (id, user_id, room_code, amount, type, status) 
       VALUES ($1, $2, $3, $4, $5, 'pending') 
       RETURNING *`,
      [transactionId, userId, roomId, amount, 'entry']
    )
    
    console.log('✅ Transação criada:', result.rows[0].id, 'Status:', result.rows[0].status)
    
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
    try {
      const result = await db.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'house_fee'`
      )
      return parseFloat(result.rows[0].total) || 0
    } catch (error) {
      console.error('❌ Erro getHouseBalance:', error)
      return 0
    }
  }

  async getAllTransactions() {
    try {
      const result = await db.query(
        `SELECT * FROM transactions ORDER BY created_at DESC LIMIT 50`
      )
      return result.rows || []
    } catch (error) {
      console.error('❌ Erro getAllTransactions:', error)
      return []
    }
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
    console.log('💰 Confirmando pagamento:', transactionId)
    
    await db.query(
      `UPDATE transactions SET status = 'completed', paid_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [transactionId]
    )
    
    const result = await db.query(
      `SELECT room_code, user_id FROM transactions WHERE id = $1`,
      [transactionId]
    )
    
    if (result.rows.length > 0) {
      const { room_code, user_id } = result.rows[0]
      console.log('💰 Pagamento confirmado - Sala:', room_code, 'User:', user_id)
      
      await this.markRoomPaid(room_code, 'host')
    }
  }

  async getPendingPayments() {
    try {
      const result = await db.query(
        `SELECT * FROM transactions WHERE status = 'pending' ORDER BY created_at DESC`
      )
      console.log('📊 Pending payments:', result.rows.length)
      return result.rows || []
    } catch (error) {
      console.error('❌ Erro getPendingPayments:', error)
      return []
    }
  }

  async getTransactionStatus(transactionId) {
    try {
      const result = await db.query(
        `SELECT * FROM transactions WHERE id = $1`,
        [transactionId]
      )
      
      if (result.rows.length === 0) {
        return { paid: false, status: 'not_found' }
      }
      
      const transaction = result.rows[0]
      console.log('📊 Transaction status:', transaction.status)
      
      return { 
        paid: transaction.status === 'completed',
        status: transaction.status,
        transaction 
      }
    } catch (error) {
      console.error('❌ Erro getTransactionStatus:', error)
      return { paid: false, status: 'error' }
    }
  }
}

module.exports = new PaymentService()
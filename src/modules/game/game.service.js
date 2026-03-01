const db = require('../../config/database')

class GameService {
  async createRoom(hostId) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase()
    await db.query(
      `INSERT INTO rooms (code, host_id) VALUES ($1, $2)`,
      [code, hostId]
    )
    return { code, hostId }
  }

  async joinRoom(code, guestId) {
    const result = await db.query(
      `UPDATE rooms SET guest_id = $1 WHERE code = $2 AND guest_id IS NULL RETURNING *`,
      [guestId, code]
    )
    return result.rows[0]
  }

  async startGame(code) {
    await db.query(
      `UPDATE rooms SET started = TRUE, started_at = NOW() WHERE code = $1`,
      [code]
    )
  }

  async endGame(code, winnerId) {
    await db.query(
      `UPDATE rooms SET ended = TRUE, ended_at = NOW(), winner_id = $1 WHERE code = $2`,
      [winnerId, code]
    )
  }

  async getRoom(code) {
    const result = await db.query(`SELECT * FROM rooms WHERE code = $1`, [code])
    return result.rows[0]
  }

  async getActiveRooms() {
    const result = await db.query(
      `SELECT * FROM rooms WHERE started = FALSE AND ended = FALSE ORDER BY created_at DESC`
    )
    return result.rows
  }
}

module.exports = new GameService()
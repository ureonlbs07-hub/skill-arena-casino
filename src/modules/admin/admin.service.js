const db = require('../../config/database')

class AdminService {
  async getSetting(key) {
    const result = await db.query(`SELECT value FROM settings WHERE key = $1`, [key])
    return result.rows[0]?.value
  }

  async updateSetting(key, value) {
    await db.query(
      `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
      [value, key]
    )
  }

  async getAllSettings() {
    const result = await db.query(`SELECT * FROM settings`)
    const settings = {}
    result.rows.forEach(row => { settings[row.key] = row.value })
    return settings
  }
}

module.exports = new AdminService()
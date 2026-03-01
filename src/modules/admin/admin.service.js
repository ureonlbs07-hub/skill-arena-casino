const db = require('../../config/database')

class AdminService {
  async updateSetting(key, value) {
    try {
      const checkResult = await db.query(
        `SELECT * FROM settings WHERE key = $1`,
        [key]
      )
      
      if (checkResult.rows.length > 0) {
        await db.query(
          `UPDATE settings SET value = $1 WHERE key = $2`,
          [value, key]
        )
      } else {
        await db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)`,
          [key, value]
        )
      }
      
      console.log(`✅ Setting atualizada: ${key} = ${value}`)
      return true
    } catch (error) {
      console.error('❌ Erro updateSetting:', error)
      throw error
    }
  }

  async getAllSettings() {
    try {
      const result = await db.query(`SELECT * FROM settings`)
      
      // ✅ CORRIGIDO: Usar reduce para criar objeto limpo
      const settings = result.rows.reduce((acc, row) => {
        acc[row.key] = row.value
        return acc
      }, {})
      
      // Valores padrão
      return {
        monetization_enabled: settings.monetization_enabled || 'false',
        entry_fee: settings.entry_fee || '10',
        prize: settings.prize || '17',
        house_fee: settings.house_fee || '3',
        ...settings
      }
    } catch (error) {
      console.error('❌ Erro getAllSettings:', error)
      return {
        monetization_enabled: 'false',
        entry_fee: '10',
        prize: '17',
        house_fee: '3'
      }
    }
  }
}

module.exports = new AdminService()
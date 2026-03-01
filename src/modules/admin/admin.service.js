const db = require('../../config/database')

class AdminService {
  // ✅ CORRIGIDO: Atualiza setting no banco
  async updateSetting(key, value) {
    try {
      // Primeiro verifica se existe
      const checkResult = await db.query(
        `SELECT 1 FROM settings WHERE key = $1`,
        [key]
      )
      
      if (checkResult.rows.length > 0) {
        // Atualiza se existe
        await db.query(
          `UPDATE settings SET value = $1 WHERE key = $2`,
          [value, key]
        )
      } else {
        // Insere se não existe
        await db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)`,
          [key, value]
        )
      }
      
      console.log(`✅ Setting atualizada: ${key} = ${value}`)
      return true
    } catch (error) {
      console.error('❌ Erro ao atualizar setting:', error)
      throw error
    }
  }

  // ✅ Pega todas as settings
  async getAllSettings() {
    try {
      const result = await db.query(`SELECT * FROM settings`)
      
      // Converte array para objeto
      const settings = {}
      result.rows.forEach(row => {
        settings[row.key] = row.value
      })
      
      // ✅ Garante valores padrão se não existir
      if (settings.monetization_enabled === undefined) {
        settings.monetization_enabled = 'false'
      }
      if (settings.entry_fee === undefined) {
        settings.entry_fee = '10'
      }
      if (settings.prize === undefined) {
        settings.prize = '17'
      }
      if (settings.house_fee === undefined) {
        settings.house_fee = '3'
      }
      
      return settings
    } catch (error) {
      console.error('❌ Erro ao pegar settings:', error)
      // Retorna valores padrão em caso de erro
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
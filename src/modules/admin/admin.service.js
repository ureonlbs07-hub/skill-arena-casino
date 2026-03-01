const db = require('../../config/database')

class AdminService {
  async updateSetting(key, value) {
    try {
      console.log('🔧 updateSetting chamado:', { key, value })
      
      const checkResult = await db.query(
        `SELECT * FROM settings WHERE key = $1`,
        [key]
      )
      
      console.log('📊 Setting encontrada:', checkResult.rows)
      
      if (checkResult.rows.length > 0) {
        await db.query(
          `UPDATE settings SET value = $1 WHERE key = $2`,
          [value, key]
        )
        console.log('✅ UPDATE realizado')
      } else {
        await db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)`,
          [key, value]
        )
        console.log('✅ INSERT realizado')
      }
      
      return true
    } catch (error) {
      console.error('❌ Erro updateSetting:', error)
      throw error
    }
  }

  async getAllSettings() {
    try {
      console.log('🔧 getAllSettings chamado')
      
      const result = await db.query(`SELECT * FROM settings`)
      
      console.log('📊 Todas as settings:', result.rows)
      console.log('📊 Colunas:', result.fields)
      
      const settings = {}
      result.rows.forEach(row => {
        // ✅ Tenta diferentes nomes de coluna
        const key = row.key || row.setting_key || row.name
        const value = row.value || row.setting_value || row.val
        if (key) {
          settings[key] = value
        }
      })
      
      console.log('📊 Settings processadas:', settings)
      
      // Valores padrão
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
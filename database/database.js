const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

pool.on('connect', () => {
  console.log('✅ PostgreSQL conectado!')
})

pool.on('error', (err) => {
  console.error('❌ Erro PostgreSQL:', err)
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
}
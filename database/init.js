const { Pool } = require('pg')
const fs = require('fs')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

async function init() {
  try {
    const schema = fs.readFileSync('./database/schema.sql', 'utf8')
    await pool.query(schema)
    console.log('✅ Banco de dados inicializado!')
    process.exit(0)
  } catch (err) {
    console.error('❌ Erro:', err)
    process.exit(1)
  }
}

init()
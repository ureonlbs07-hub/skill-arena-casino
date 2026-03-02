require('dotenv').config()

const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const fs = require('fs')

const db = require('./src/config/database')
const gameService = require('./src/modules/game/game.service')
const paymentService = require('./src/modules/payment/payment.service')
const adminService = require('./src/modules/admin/admin.service')
const { generateDeck } = require('./src/utils/helpers')

const paymentRoutes = require('./src/modules/payment/payment.routes')
const adminRoutes = require('./src/modules/admin/admin.routes')
const gameRoutes = require('./src/modules/game/game.routes')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
})

let rooms = {}
let users = {}
let adminSessions = {}

app.use('/api/payment', paymentRoutes)
app.use('/api/game', gameRoutes)
app.use('/api/admin', adminRoutes)

app.get('/api/room/status/:code', async (req, res) => {
  try {
    const { code } = req.params
    
    if (rooms[code]) {
      return res.json({
        hostPaid: rooms[code].hostPaid || false,
        guestPaid: rooms[code].guestPaid || false
      })
    }
    
    const result = await db.query(
      `SELECT host_paid, guest_paid FROM rooms WHERE code = $1`,
      [code]
    )
    
    if (result.rows.length === 0) {
      return res.json({ hostPaid: false, guestPaid: false })
    }
    
    res.json({
      hostPaid: result.rows[0].host_paid,
      guestPaid: result.rows[0].guest_paid
    })
  } catch (error) {
    console.error('Erro ao verificar status da sala:', error)
    res.json({ hostPaid: false, guestPaid: false })
  }
})

/* ============================================= */
/* 🔥 ROTA CORRIGIDA DE CONFIRMAÇÃO DE PAGAMENTO */
/* ============================================= */

app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { transactionId, password } = req.body

    console.log('💰 Admin confirmando pagamento:', transactionId)

    if (password !== 'admin123') {
      console.log('❌ Password inválido')
      return res.status(401).json({ success: false, error: 'Não autorizado' })
    }

    console.log('✅ Admin autorizado!')

    await paymentService.confirmPayment(transactionId)

    const txResult = await db.query(
      `SELECT room_code, player_type FROM transactions WHERE id = $1`,
      [transactionId]
    )

    if (txResult.rows.length === 0) {
      return res.json({ success: false, error: 'Transação não encontrada' })
    }

    const roomCode = txResult.rows[0].room_code
    const playerType = txResult.rows[0].player_type

    const column = playerType === 'host' ? 'host_paid' : 'guest_paid'

    await db.query(
      `UPDATE rooms SET ${column} = TRUE WHERE code = $1`,
      [roomCode]
    )

    console.log('✅ Banco atualizado:', column)

    // 🔥 GARANTIR QUE SALA EXISTA EM MEMÓRIA
    if (!rooms[roomCode]) {
      const roomFromDb = await db.query(
        `SELECT host_id, guest_id, host_paid, guest_paid FROM rooms WHERE code = $1`,
        [roomCode]
      )

      if (roomFromDb.rows.length > 0) {
        const r = roomFromDb.rows[0]

        rooms[roomCode] = {
          code: roomCode,
          host: r.host_id,
          guest: r.guest_id,
          hostPaid: r.host_paid,
          guestPaid: r.guest_paid,
          started: false,
          board: [],
          deck: [],
          hands: {},
          turn: null
        }

        console.log('♻️ Sala recriada em memória:', roomCode)
      }
    }

    // 🔥 Atualizar memória
    if (rooms[roomCode]) {
      if (playerType === 'host') {
        rooms[roomCode].hostPaid = true
      } else {
        rooms[roomCode].guestPaid = true
      }

      console.log('📊 Estado memória:',
        rooms[roomCode].hostPaid,
        rooms[roomCode].guestPaid
      )
    }

    const room = rooms[roomCode]

    if (room && room.hostPaid && room.guestPaid && room.host) {
      console.log('🚀 Ambos pagaram! Emitindo bothPaid para:', room.host)
      io.to(room.host).emit('bothPaid', { roomId: roomCode })
    }

    res.json({ success: true })

  } catch (error) {
    console.error('❌ Erro ao confirmar pagamento:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/* ============================================= */
/* RESTANTE DO ARQUIVO PERMANECE IGUAL */
/* ============================================= */

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html')
})

function sendRoomList() {
  const list = Object.values(rooms).map(r => ({
    code: r.code,
    players: (r.host ? 1 : 0) + (r.guest ? 1 : 0),
    started: r.started,
    hostPaid: r.hostPaid || false,
    guestPaid: r.guestPaid || false
  }))
  io.emit('roomList', list)
}

const PORT = process.env.PORT || 3000

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Servidor rodando na porta', PORT)
})
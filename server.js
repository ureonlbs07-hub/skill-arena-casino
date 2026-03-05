require('dotenv').config()

const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

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
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
})

let rooms = {}
let users = {}
let socketToRoom = {}

// ============================================
// ✅ ROTAS DA API
// ============================================
app.use('/api/payment', paymentRoutes)
app.use('/api/game', gameRoutes)
app.use('/api/admin', adminRoutes)

// ✅ Rota para verificar status da sala
app.get('/api/room/status/:code', async (req, res) => {
  try {
    const { code } = req.params
    if (rooms[code]) {
      return res.json({ hostPaid: rooms[code].hostPaid || false, guestPaid: rooms[code].guestPaid || false })
    }
    const result = await db.query(`SELECT host_paid, guest_paid FROM rooms WHERE code = $1`, [code])
    if (result.rows.length === 0) return res.json({ hostPaid: false, guestPaid: false })
    res.json({ hostPaid: result.rows[0].host_paid, guestPaid: result.rows[0].guest_paid })
  } catch (error) {
    console.error('Erro status sala:', error)
    res.json({ hostPaid: false, guestPaid: false })
  }
})

// ✅ Rota para verificar se sala existe
app.get('/api/room/:code', async (req, res) => {
  const room = rooms[req.params.code]
  if (!room) return res.json({ exists: false })
  res.json({ exists: true, players: (room.host ? 1 : 0) + (room.guest ? 1 : 0), started: room.started })
})

// ✅ Rota admin confirmar pagamento
app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { transactionId, password } = req.body
    if (password !== 'admin123') return res.status(401).json({ success: false, error: 'Não autorizado' })
    
    await paymentService.confirmPayment(transactionId)
    
    const txResult = await db.query(`SELECT room_code, player_type FROM transactions WHERE id = $1`, [transactionId])
    if (txResult.rows.length === 0) return res.json({ success: false, error: 'Transação não encontrada' })
    
    const roomCode = txResult.rows[0].room_code
    const playerType = txResult.rows[0].player_type
    const column = playerType === 'host' ? 'host_paid' : 'guest_paid'
    
    await db.query(`UPDATE rooms SET ${column} = TRUE WHERE code = $1`, [roomCode])
    
    if (rooms[roomCode]) {
      rooms[roomCode][playerType === 'host' ? 'hostPaid' : 'guestPaid'] = true
    }
    
    const room = rooms[roomCode]
    if (room && room.hostPaid && room.guestPaid && room.host) {
      io.to(room.host).emit('bothPaid', { roomId: roomCode })
    }
    
    res.json({ success: true })
  } catch (error) {
    console.error('Erro confirmar pagamento:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ✅ ROTA DO ADMIN PANEL - GARANTIDA!
app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'public', 'admin.html')
  console.log('📁 Admin path:', adminPath)
  res.sendFile(adminPath)
})

app.get('/api/monetization-status', async (req, res) => {
  const settings = await adminService.getAllSettings()
  res.json({
    enabled: settings.monetization_enabled === 'true',
    entryFee: parseFloat(settings.entry_fee),
    prize: parseFloat(settings.prize),
    houseFee: parseFloat(settings.house_fee)
  })
})

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }))

// ============================================
// ✅ BANCO DE DADOS
// ============================================
async function initDatabase() {
  try {
    const schema = fs.readFileSync('./database/schema.sql', 'utf8')
    await db.query(schema)
    await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS player_type VARCHAR(20)`)
    console.log('✅ Banco pronto!')
  } catch (err) {
    console.error('❌ Erro banco:', err.message)
  }
}

// ============================================
// ✅ SOCKET.IO
// ============================================
io.on('connection', (socket) => {
  console.log('🔌 Conectado:', socket.id)
  sendRoomList()

  socket.on('register', async (username) => {
    await db.query(`INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET username = $2`, [socket.id, username])
    users[socket.id] = { username }
    socket.emit('registered', { id: socket.id, username })
  })

  socket.on('reconnect', (data) => {
    console.log('🔄 Socket reconectou:', socket.id)
    const roomCode = socketToRoom[socket.id]
    if (roomCode && rooms[roomCode]) {
      socket.join(roomCode)
    }
  })

  socket.on('createRoom', async () => {
    const room = await gameService.createRoom(socket.id)
    rooms[room.code] = { 
      code: room.code, 
      host: socket.id, 
      guest: null,
      hostPaid: false, 
      guestPaid: false, 
      started: false,
      board: [],
      deck: [],
      hands: {},
      turn: socket.id
    }
    socketToRoom[socket.id] = room.code
    socket.join(room.code)
    console.log('🏠 Sala criada:', room.code)
    
    const settings = await adminService.getAllSettings()
    if (settings.monetization_enabled === 'true') {
      socket.emit('paymentRequired', { amount: parseFloat(settings.entry_fee), roomId: room.code, userId: socket.id, playerType: 'host' })
    } else {
      await paymentService.markRoomPaid(room.code, 'host')
      rooms[room.code].hostPaid = true
      socket.emit('roomCreated', { code: room.code })
    }
    sendRoomList()
  })

  socket.on('joinRoom', async (code) => {
    const room = await gameService.getRoom(code)
    if (!room) return socket.emit('error', { message: 'Sala não existe' })
    if (room.started) return socket.emit('error', { message: 'Jogo já começou' })
    if (room.guest_id) return socket.emit('error', { message: 'Sala cheia' })
    if (room.host_id === socket.id) return socket.emit('error', { message: 'Você é o host!' })

    await gameService.joinRoom(code, socket.id)
    
    rooms[code] = { 
      code: code, 
      host: room.host_id, 
      guest: socket.id,
      hostPaid: room.host_paid, 
      guestPaid: room.guest_paid, 
      started: room.started,
      board: [],
      deck: [],
      hands: {},
      turn: room.host_id
    }
    
    socketToRoom[socket.id] = code
    socket.join(code)
    
    console.log('👤 Guest entrou:', code)

    const settings = await adminService.getAllSettings()
    if (settings.monetization_enabled === 'true') {
      socket.emit('paymentRequired', { amount: parseFloat(settings.entry_fee), roomId: code, userId: socket.id, playerType: 'guest' })
    } else {
      await paymentService.markRoomPaid(code, 'guest')
      rooms[code].guestPaid = true
      io.to(rooms[code].host).emit('guestJoined', { code })
      io.to(rooms[code].host).emit('bothPaid', { roomId: code })
      socket.emit('roomJoined', { code })
    }
    sendRoomList()
  })

  socket.on('startGame', async (code) => {
    const room = rooms[code]
    if (!room) return socket.emit('error', { message: 'Sala não encontrada' })
    if (room.host !== socket.id) return socket.emit('error', { message: 'Apenas host pode iniciar' })
    if (!room.guest) return socket.emit('error', { message: 'Aguarde o convidado' })
    if (room.started) return

    const settings = await adminService.getAllSettings()
    if (settings.monetization_enabled === 'true' && (!room.hostPaid || !room.guestPaid)) {
      return socket.emit('error', { message: 'Ambos devem pagar!' })
    }

    await gameService.startGame(code)
    rooms[code].started = true
    
    const deck = generateDeck()
    rooms[code].deck = deck.slice(14)
    rooms[code].hands = { [room.host]: deck.slice(0, 7), [room.guest]: deck.slice(7, 14) }
    rooms[code].board = []
    rooms[code].turn = room.host

    io.to(room.host).emit('gameStart', { hand: rooms[code].hands[room.host], isHost: true, deckCount: rooms[code].deck.length, opponent: users[room.guest]?.username || 'Oponente' })
    io.to(room.guest).emit('gameStart', { hand: rooms[code].hands[room.guest], isHost: false, deckCount: rooms[code].deck.length, opponent: users[room.host]?.username || 'Oponente' })
    io.emit('update', { board: [], turn: rooms[code].turn, deckCount: rooms[code].deck.length })
  })

  socket.on('play', async ({ code, tile, side }) => {
    const room = rooms[code]
    if (!room) return socket.emit('error', { message: 'Sala não encontrada' })
    if (room.turn !== socket.id) return socket.emit('error', { message: 'Não é sua vez!' })

    const hand = room.hands[socket.id]
    if (!hand) return socket.emit('error', { message: 'Mão não encontrada' })

    const tile0 = Number(tile[0]), tile1 = Number(tile[1])
    const tileIndex = hand.findIndex(t => Number(t[0]) === tile0 && Number(t[1]) === tile1)
    if (tileIndex === -1) return socket.emit('error', { message: 'Você não tem esta pedra!' })

    if (room.board.length === 0) {
      room.board.push([tile0, tile1])
    } else {
      const left = room.board[0][0], right = room.board[room.board.length - 1][1]
      let played = false
      if (side === 'left') {
        if (tile1 === left) { room.board.unshift([tile0, tile1]); played = true }
        else if (tile0 === left) { room.board.unshift([tile1, tile0]); played = true }
      }
      if (side === 'right' && !played) {
        if (tile0 === right) { room.board.push([tile0, tile1]); played = true }
        else if (tile1 === right) { room.board.push([tile1, tile0]); played = true }
      }
      if (!played) return socket.emit('error', { message: 'Não encaixa!' })
    }

    hand.splice(tileIndex, 1)

    if (hand.length === 0) {
      const settings = await adminService.getAllSettings()
      if (settings.monetization_enabled === 'true') await paymentService.recordHouseFee(code, parseFloat(settings.house_fee))
      await gameService.endGame(code, socket.id)
      io.emit('gameOver', { winner: socket.id })
      delete rooms[code]
      delete socketToRoom[socket.id]
      sendRoomList()
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host
    socket.emit('tilePlayed', { hand: room.hands[socket.id], board: room.board, turn: room.turn, deckCount: room.deck.length })
    io.emit('update', { board: room.board, turn: room.turn, deckCount: room.deck.length })
  })

  socket.on('buyTile', ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id || room.deck.length === 0) return socket.emit('error', { message: 'Erro ao comprar' })
    const tile = room.deck.pop()
    room.hands[socket.id].push(tile)
    socket.emit('tileBought', { hand: room.hands[socket.id], deckCount: room.deck.length, board: room.board })
  })

  socket.on('passTurn', ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id) return
    room.turn = room.turn === room.host ? room.guest : room.host
    io.emit('update', { board: room.board, turn: room.turn, deckCount: room.deck.length })
  })

  socket.on('paymentConfirmed', (data) => console.log('💰 Pagamento confirmado:', data))

  socket.on('disconnect', () => {
    console.log('❌ Disconnect:', socket.id)
    sendRoomList()
  })
})

function sendRoomList() {
  const list = Object.values(rooms).map(r => ({ code: r.code, players: (r.host ? 1 : 0) + (room.guest ? 1 : 0), started: r.started, hostPaid: r.hostPaid || false, guestPaid: r.guestPaid || false }))
  io.emit('roomList', list)
}

// ============================================
// ✅ INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000

initDatabase().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('============================================')
    console.log('🚀 Servidor na porta', PORT)
    console.log('🔐 Admin: http://localhost:' + PORT + '/admin')
    console.log('🎮 Jogo: http://localhost:' + PORT)
    console.log('📊 PostgreSQL: Conectado')
    console.log('============================================')
  })
})
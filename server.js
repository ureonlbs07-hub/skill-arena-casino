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

// ✅ ROTAS DEFINIDAS APENAS UMA VEZ
app.use('/api/payment', paymentRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/game', gameRoutes)

// ✅ INICIALIZAR IO NAS ROTAS DE PAGAMENTO
paymentRoutes.setIO(io)

app.get('/api/monetization-status', async (req, res) => {
  const settings = await adminService.getAllSettings()
  res.json({
    enabled: settings.monetization_enabled === 'true',
    entryFee: parseFloat(settings.entry_fee),
    prize: parseFloat(settings.prize),
    houseFee: parseFloat(settings.house_fee)
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// ============================================
// 🔥 ROTA DO ADMIN
// ============================================
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html')
})

// ============================================
// 🔥 AUTO-CRIAR TABELAS NO STARTUP
// ============================================
async function initDatabase() {
  try {
    const schema = fs.readFileSync('./database/schema.sql', 'utf8')
    await db.query(schema)
    console.log('✅ Tabelas criadas/atualizadas!')
  } catch (err) {
    console.error('❌ Erro ao criar tabelas:', err.message)
  }
}

io.on('connection', (socket) => {
  console.log('🔌 Conectado:', socket.id)
  sendRoomList()

  socket.on('register', async (username) => {
    await db.query(
      `INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET username = $2`,
      [socket.id, username]
    )
    users[socket.id] = { username }
    socket.emit('registered', { id: socket.id, username })
  })

  socket.on('createRoom', async () => {
    const room = await gameService.createRoom(socket.id)
    rooms[room.code] = { 
      code: room.code, 
      host: room.hostId, 
      guest: null,
      hostPaid: false, 
      guestPaid: false, 
      started: false,
      board: [],
      deck: [],
      hands: {},
      turn: null
    }
    
    console.log('🏠 Sala criada:', room.code)
    
    const settings = await adminService.getAllSettings()
    if (settings.monetization_enabled === 'true') {
      socket.emit('paymentRequired', {
        amount: parseFloat(settings.entry_fee),
        roomId: room.code,
        userId: socket.id,
        playerType: 'host'
      })
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
    if (room.host_id === socket.id) return socket.emit('error', { message: 'Você já é o host!' })

    await gameService.joinRoom(code, socket.id)
    rooms[code].guest = socket.id
    rooms[code].guest_id = socket.id
    
    console.log('👤 Guest entrou:', code)

    const settings = await adminService.getAllSettings()
    if (settings.monetization_enabled === 'true') {
      socket.emit('paymentRequired', {
        amount: parseFloat(settings.entry_fee),
        roomId: code,
        userId: socket.id,
        playerType: 'guest'
      })
    } else {
      await paymentService.markRoomPaid(code, 'guest')
      rooms[code].guestPaid = true
      io.to(rooms[code].host).emit('guestJoined', { code, guestId: socket.id })
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
    
    const settings = await adminService.getAllSettings()
    if (settings.monetization_enabled === 'true') {
      if (!room.hostPaid || !room.guestPaid) {
        return socket.emit('error', { message: 'Ambos devem pagar!' })
      }
    }
    
    if (room.started) return

    await gameService.startGame(code)
    rooms[code].started = true
    
    const deck = generateDeck()
    rooms[code].deck = deck.slice(14)
    rooms[code].hands = {
      [room.host]: deck.slice(0, 7),
      [room.guest]: deck.slice(7, 14)
    }
    rooms[code].board = []
    rooms[code].turn = room.host

    console.log('🎮 Jogo iniciado:', code)
    console.log('🎮 Turno inicial:', rooms[code].turn)
    console.log('🎮 Host:', rooms[code].host)
    console.log('🎮 Guest:', rooms[code].guest)

    io.to(room.host).emit('gameStart', {
      hand: rooms[code].hands[room.host],
      isHost: true,
      deckCount: rooms[code].deck.length,
      opponent: users[room.guest]?.username || 'Oponente'
    })

    io.to(room.guest).emit('gameStart', {
      hand: rooms[code].hands[room.guest],
      isHost: false,
      deckCount: rooms[code].deck.length,
      opponent: users[room.host]?.username || 'Oponente'
    })

    io.emit('update', {
      board: [],
      turn: rooms[code].turn,
      deckCount: rooms[code].deck.length
    })
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
      console.log('🏆 Vencedor:', socket.id, 'Sala:', code)
      
      const settings = await adminService.getAllSettings()
      if (settings.monetization_enabled === 'true') {
        await paymentService.recordHouseFee(code, parseFloat(settings.house_fee))
      }
      
      await gameService.endGame(code, socket.id)
      io.emit('gameOver', { winner: socket.id })
      delete rooms[code]
      sendRoomList()
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host
    console.log('🎴 Jogada realizada! Próximo turno:', room.turn)

    socket.emit('tilePlayed', {
      hand: room.hands[socket.id],
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })

    io.emit('update', {
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })
  })

  socket.on('buyTile', ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id || room.deck.length === 0) {
      return socket.emit('error', { message: 'Erro ao comprar' })
    }
    const tile = room.deck.pop()
    room.hands[socket.id].push(tile)
    socket.emit('tileBought', {
      hand: room.hands[socket.id],
      deckCount: room.deck.length,
      board: room.board
    })
  })

  socket.on('passTurn', ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id) return
    room.turn = room.turn === room.host ? room.guest : room.host
    console.log('⏭️ Turno passado! Próximo:', room.turn)
    io.emit('update', { board: room.board, turn: room.turn, deckCount: room.deck.length })
  })

  socket.on('paymentConfirmed', async (data) => {
    console.log('💰 Pagamento confirmado pelo jogador:', data)
  })

  socket.on('disconnect', async () => {
    console.log('❌ Disconnect:', socket.id)
    for (const code in rooms) {
      if (rooms[code].host === socket.id || rooms[code].guest === socket.id) {
        await db.query(`UPDATE rooms SET ended = TRUE WHERE code = $1`, [code])
        delete rooms[code]
      }
    }
    sendRoomList()
  })
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

// ============================================
// 🚀 INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000

initDatabase().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('============================================')
    console.log('🚀 Servidor rodando na porta', PORT)
    console.log('🔐 Admin: http://localhost:' + PORT + '/admin')
    console.log('🎮 Jogo: http://localhost:' + PORT)
    console.log('📊 PostgreSQL: Conectado')
    console.log('============================================')
  })
})
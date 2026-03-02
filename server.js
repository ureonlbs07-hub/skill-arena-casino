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
    res.json({ hostPaid: false, guestPaid: false })
  }
})

app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { transactionId, password } = req.body

    if (password !== 'admin123') {
      return res.status(401).json({ success: false })
    }

    await paymentService.confirmPayment(transactionId)

    const txResult = await db.query(
      `SELECT room_code, player_type FROM transactions WHERE id = $1`,
      [transactionId]
    )

    if (!txResult.rows.length) {
      return res.json({ success: false })
    }

    const roomCode = txResult.rows[0].room_code
    const playerType = txResult.rows[0].player_type

    const column = playerType === 'host' ? 'host_paid' : 'guest_paid'

    await db.query(
      `UPDATE rooms SET ${column} = TRUE WHERE code = $1`,
      [roomCode]
    )

    if (rooms[roomCode]) {
      if (playerType === 'host') rooms[roomCode].hostPaid = true
      else rooms[roomCode].guestPaid = true
    }

    const room = rooms[roomCode]

    if (room && room.hostPaid && room.guestPaid) {
      io.to(roomCode).emit('bothPaid', { roomId: roomCode })
    }

    res.json({ success: true })

  } catch (error) {
    res.status(500).json({ success: false })
  }
})

async function initDatabase() {
  try {
    const schema = fs.readFileSync('./database/schema.sql', 'utf8')
    await db.query(schema)
  } catch (err) {
    console.error(err.message)
  }
}

io.on('connection', (socket) => {

  sendRoomList()

  socket.on('register', async (username) => {
    await db.query(
      `INSERT INTO users (id, username) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET username = $2`,
      [socket.id, username]
    )

    users[socket.id] = { username }

    socket.emit('registered', { id: socket.id, username })
  })

  socket.on('createRoom', async () => {

    const roomData = await gameService.createRoom(socket.id)

    rooms[roomData.code] = {
      code: roomData.code,
      host: socket.id,
      guest: null,
      hostPaid: false,
      guestPaid: false,
      started: false,
      board: [],
      deck: [],
      hands: {},
      turn: null
    }

    socket.join(roomData.code)

    const settings = await adminService.getAllSettings()

    if (settings.monetization_enabled === 'true') {
      socket.emit('paymentRequired', {
        amount: parseFloat(settings.entry_fee),
        roomId: roomData.code,
        userId: socket.id,
        playerType: 'host'
      })
    } else {
      await paymentService.markRoomPaid(roomData.code, 'host')
      rooms[roomData.code].hostPaid = true
      socket.emit('roomCreated', { code: roomData.code })
    }

    sendRoomList()
  })

  socket.on('joinRoom', async (code) => {

    const roomDb = await gameService.getRoom(code)
    if (!roomDb) return socket.emit('error', { message: 'Sala não existe' })
    if (roomDb.started) return socket.emit('error', { message: 'Jogo já começou' })
    if (roomDb.guest_id) return socket.emit('error', { message: 'Sala cheia' })
    if (roomDb.host_id === socket.id) return socket.emit('error', { message: 'Você já é o host!' })

    await gameService.joinRoom(code, socket.id)

    rooms[code].guest = socket.id
    socket.join(code)

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
      io.to(code).emit('bothPaid', { roomId: code })
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
    room.started = true

    const deck = generateDeck()

    room.deck = deck.slice(14)
    room.hands = {
      [room.host]: deck.slice(0, 7),
      [room.guest]: deck.slice(7, 14)
    }
    room.board = []
    room.turn = room.host

    io.to(room.host).emit('gameStart', {
      hand: room.hands[room.host],
      isHost: true,
      deckCount: room.deck.length
    })

    io.to(room.guest).emit('gameStart', {
      hand: room.hands[room.guest],
      isHost: false,
      deckCount: room.deck.length
    })

    io.to(code).emit('update', {
      board: [],
      turn: room.turn,
      deckCount: room.deck.length
    })
  })

  socket.on('play', async ({ code, tile, side }) => {

    const room = rooms[code]
    if (!room) return socket.emit('error', { message: 'Sala não encontrada' })
    if (room.turn !== socket.id) return socket.emit('error', { message: 'Não é sua vez!' })

    const hand = room.hands[socket.id]
    const tileIndex = hand.findIndex(t =>
      Number(t[0]) === Number(tile[0]) &&
      Number(t[1]) === Number(tile[1])
    )

    if (tileIndex === -1) return socket.emit('error', { message: 'Você não tem esta pedra!' })

    const tile0 = Number(tile[0])
    const tile1 = Number(tile[1])

    if (room.board.length === 0) {
      room.board.push([tile0, tile1])
    } else {
      const left = room.board[0][0]
      const right = room.board[room.board.length - 1][1]

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
      await gameService.endGame(code, socket.id)
      io.to(code).emit('gameOver', { winner: socket.id })
      delete rooms[code]
      sendRoomList()
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host

    socket.emit('tilePlayed', {
      hand: room.hands[socket.id],
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })

    io.to(code).emit('update', {
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })
  })

  socket.on('buyTile', ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id || room.deck.length === 0) return

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

    io.to(code).emit('update', {
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })
  })

  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].host === socket.id || rooms[code].guest === socket.id) {
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
    started: r.started
  }))
  io.emit('roomList', list)
}

const PORT = process.env.PORT || 3000

initDatabase().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Servidor rodando na porta', PORT)
  })
})
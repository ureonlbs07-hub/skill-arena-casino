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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

async function initDatabase() {
  try {

    const schema = fs.readFileSync('./database/schema.sql', 'utf8')
    await db.query(schema)

    console.log('✅ Banco inicializado')

  } catch (err) {
    console.error('Erro DB:', err.message)
  }
}

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

io.on('connection', (socket) => {

  console.log('🔌 Conectado:', socket.id)

  sendRoomList()

  socket.on('register', async (username) => {

    await db.query(
      `INSERT INTO users (id, username)
       VALUES ($1,$2)
       ON CONFLICT (id)
       DO UPDATE SET username=$2`,
      [socket.id, username]
    )

    users[socket.id] = { username }

    socket.emit('registered', {
      id: socket.id,
      username
    })

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

    socket.emit('roomCreated', { code: room.code })

    sendRoomList()

  })

  socket.on('joinRoom', async (code) => {

    const room = rooms[code]

    if (!room) {
      return socket.emit('error', { message: 'Sala não encontrada' })
    }

    if (room.guest) {
      return socket.emit('error', { message: 'Sala cheia' })
    }

    room.guest = socket.id

    socket.emit('roomJoined', { code })

    io.to(room.host).emit('guestJoined', { code })

    sendRoomList()

  })

  socket.on('startGame', async (code) => {

    const room = rooms[code]

    if (!room) return
    if (room.host !== socket.id) return
    if (!room.guest) return

    const deck = generateDeck()

    room.deck = deck.slice(14)

    room.hands = {
      [room.host]: deck.slice(0,7),
      [room.guest]: deck.slice(7,14)
    }

    room.board = []
    room.started = true
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

    io.emit('update', {
      board: [],
      turn: room.turn,
      deckCount: room.deck.length
    })

  })

  socket.on('play', ({ code, tile, side }) => {

    const room = rooms[code]

    if (!room) return

    if (room.turn !== socket.id) {
      return socket.emit('error', { message:'Não é sua vez' })
    }

    const hand = room.hands[socket.id]

    const index = hand.findIndex(t =>
      t[0] === tile[0] && t[1] === tile[1]
    )

    if (index === -1) {
      return socket.emit('error', { message:'Você não tem essa pedra' })
    }

    hand.splice(index,1)

    if (room.board.length === 0) {
      room.board.push(tile)
    } else {

      const left = room.board[0][0]
      const right = room.board[room.board.length-1][1]

      if (side === 'left') {

        if (tile[1] === left)
          room.board.unshift(tile)

        else if (tile[0] === left)
          room.board.unshift([tile[1],tile[0]])

        else
          return socket.emit('error',{message:'Não encaixa'})
      }

      if (side === 'right') {

        if (tile[0] === right)
          room.board.push(tile)

        else if (tile[1] === right)
          room.board.push([tile[1],tile[0]])

        else
          return socket.emit('error',{message:'Não encaixa'})
      }

    }

    room.turn = room.turn === room.host
      ? room.guest
      : room.host

    io.emit('update',{
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })

  })

  socket.on('buyTile', ({code}) => {

    const room = rooms[code]

    if (!room) return
    if (room.turn !== socket.id) return
    if (room.deck.length === 0) return

    const tile = room.deck.pop()

    room.hands[socket.id].push(tile)

    socket.emit('tileBought',{
      hand: room.hands[socket.id],
      deckCount: room.deck.length,
      board: room.board
    })

  })

  socket.on('passTurn', ({code}) => {

    const room = rooms[code]

    if (!room) return
    if (room.turn !== socket.id) return

    room.turn = room.turn === room.host
      ? room.guest
      : room.host

    io.emit('update',{
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })

  })

  socket.on('disconnect', async () => {

    console.log('Player disconnected:', socket.id)

    for (const code in rooms) {

      const room = rooms[code]

      if (!room) continue

      if (room.host === socket.id) {

        if (room.guest) {

          io.to(room.guest).emit('matchCancelled',{
            message:'Host saiu da sala.'
          })

        }

        delete rooms[code]

        sendRoomList()

        break
      }

      if (room.guest === socket.id) {

        room.guest = null
        room.started = false

        io.to(room.host).emit('guestLeft',{
          message:'Oponente saiu.'
        })

        sendRoomList()

        break
      }

    }

  })

})

const PORT = process.env.PORT || 3000

initDatabase().then(() => {

  server.listen(PORT,'0.0.0.0',() => {

    console.log('=================================')
    console.log('🚀 Servidor rodando na porta',PORT)
    console.log('🎮 http://localhost:'+PORT)
    console.log('=================================')

  })

})
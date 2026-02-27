require("dotenv").config()

const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const { v4: uuid } = require("uuid")

const app = express()
app.use(express.json())
app.use(express.static("public"))

const server = http.createServer(app)

// ✅ CORS ADICIONADO (necessário para produção)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

// ============================================
// 🔥 DADOS DO JOGO
// ============================================
let rooms = {}
let users = {}

// ============================================
// 🔥 CONFIGURAÇÕES DO ADMIN
// ============================================
let adminSettings = {
  monetizationEnabled: false, // 🔥 Toggle ON/OFF
  entryFee: 10.00,
  prize: 17.00,
  houseFee: 3.00,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
}

let adminSessions = {}
let houseBalance = 0
let transactions = []

// ============================================
// FUNÇÕES AUXILIARES
// ============================================
function generateCode() {
  return uuid().replace(/-/g, "").slice(0, 8).toUpperCase()
}

function generateDeck() {
  const deck = []
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      deck.push([i, j])
    }
  }
  return deck.sort(() => Math.random() - 0.5)
}

function sendRoomList() {
  const list = Object.values(rooms).map(r => ({
    code: r.code,
    players: (r.host ? 1 : 0) + (r.guest ? 1 : 0),
    started: r.started,
    hostId: r.host,
    hostPaid: r.hostPaid || false,
    guestPaid: r.guestPaid || false,
    bothPaid: (r.hostPaid && r.guestPaid) || false
  }))
  io.emit("roomList", list)
}

// ============================================
// 🔥 ROTAS DE ADMIN
// ============================================

// Página de Login Admin
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html')
})

// Login API
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body
  
  if (password === adminSettings.adminPassword) {
    const sessionId = uuid()
    adminSessions[sessionId] = {
      loggedIn: true,
      createdAt: Date.now()
    }
    console.log('🔐 Admin logado:', sessionId)
    res.json({ success: true, sessionId })
  } else {
    console.log('❌ Tentativa de login falhou')
    res.status(401).json({ success: false, error: 'Senha incorreta' })
  }
})

// Buscar Configurações
app.get('/api/admin/settings', (req, res) => {
  res.json({
    monetizationEnabled: adminSettings.monetizationEnabled,
    entryFee: adminSettings.entryFee,
    prize: adminSettings.prize,
    houseFee: adminSettings.houseFee
  })
})

// Atualizar Configurações (Toggle Monetização)
app.post('/api/admin/settings', (req, res) => {
  const { sessionId, monetizationEnabled } = req.body
  
  if (!adminSessions[sessionId]) {
    return res.status(401).json({ success: false, error: 'Não autorizado' })
  }
  
  adminSettings.monetizationEnabled = monetizationEnabled === true
  console.log('💰 Monetização:', adminSettings.monetizationEnabled ? '✅ ATIVADA' : '❌ DESATIVADA')
  
  // Notificar todos os clientes sobre mudança
  io.emit('monetizationStatus', { enabled: adminSettings.monetizationEnabled })
  
  res.json({ success: true, settings: adminSettings })
})

// Dados do Admin Dashboard
app.get('/api/admin/data', (req, res) => {
  res.json({
    houseBalance,
    rooms: Object.values(rooms),
    transactions,
    settings: adminSettings
  })
})

// Status da Monetização (Público - para o jogo verificar)
app.get('/api/monetization-status', (req, res) => {
  res.json({
    enabled: adminSettings.monetizationEnabled,
    entryFee: adminSettings.entryFee,
    prize: adminSettings.prize,
    houseFee: adminSettings.houseFee
  })
})

// ============================================
// 🔥 SOCKET.IO - JOGO
// ============================================
io.on("connection", (socket) => {
  console.log("🔌 Conectado:", socket.id)
  sendRoomList()

  // Registrar usuário
  socket.on("register", (username) => {
    users[socket.id] = { username }
    socket.emit("registered", { id: socket.id, username })
    console.log('✅ Usuário registrado:', username)
  })

  // Criar sala
  socket.on("createRoom", () => {
    const code = generateCode()
    rooms[code] = {
      code,
      host: socket.id,
      guest: null,
      board: [],
      hands: {},
      deck: [],
      turn: null,
      started: false,
      hostPaid: false,
      guestPaid: false
    }
    console.log("🏠 Sala criada:", code, "Host:", socket.id)
    socket.emit("roomCreated", { code })
    sendRoomList()
  })

  // Entrar na sala
  socket.on("joinRoom", (code) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não existe" })
    if (room.started) return socket.emit("error", { message: "Jogo já começou" })
    if (room.guest) return socket.emit("error", { message: "Sala cheia" })
    if (room.host === socket.id) {
      return socket.emit("error", { message: "Você já é o host desta sala!" })
    }

    room.guest = socket.id
    console.log("👤 Guest entrou:", socket.id, "Sala:", code)

    io.to(room.host).emit("guestJoined", { code, guestId: socket.id })
    socket.emit("roomJoined", { code })
    sendRoomList()
  })

  // Iniciar jogo
  socket.on("startGame", (code) => {
    const room = rooms[code]
    if (!room) return
    if (room.host !== socket.id) return socket.emit("error", { message: "Apenas host pode iniciar" })
    if (!room.guest) return socket.emit("error", { message: "Aguarde o convidado entrar" })
    if (room.started) return

    room.started = true
    const deck = generateDeck()
    room.deck = deck.slice(14)
    room.hands = {
      [room.host]: deck.slice(0, 7),
      [room.guest]: deck.slice(7, 14)
    }
    room.board = []
    room.turn = room.host

    console.log("🎮 Jogo iniciado!", code)

    io.to(room.host).emit("gameStart", {
      hand: room.hands[room.host],
      isHost: true,
      deckCount: room.deck.length,
      opponent: users[room.guest]?.username || "Oponente"
    })

    io.to(room.guest).emit("gameStart", {
      hand: room.hands[room.guest],
      isHost: false,
      deckCount: room.deck.length,
      opponent: users[room.host]?.username || "Oponente"
    })

    io.emit("update", {
      board: [],
      turn: room.turn,
      deckCount: room.deck.length
    })
  })

  // Jogar pedra
  socket.on("play", ({ code, tile, side }) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não encontrada" })
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })

    const hand = room.hands[socket.id]
    if (!hand) return socket.emit("error", { message: "Mão não encontrada" })

    const tile0 = Number(tile[0])
    const tile1 = Number(tile[1])

    const tileIndex = hand.findIndex(t => Number(t[0]) === tile0 && Number(t[1]) === tile1)

    if (tileIndex === -1) {
      return socket.emit("error", { message: "Você não tem esta pedra!" })
    }

    if (room.board.length === 0) {
      room.board.push([tile0, tile1])
    } else {
      const left = room.board[0][0]
      const right = room.board[room.board.length - 1][1]
      let played = false

      if (side === "left") {
        if (tile1 === left) {
          room.board.unshift([tile0, tile1])
          played = true
        } else if (tile0 === left) {
          room.board.unshift([tile1, tile0])
          played = true
        }
      }

      if (side === "right" && !played) {
        if (tile0 === right) {
          room.board.push([tile0, tile1])
          played = true
        } else if (tile1 === right) {
          room.board.push([tile1, tile0])
          played = true
        }
      }

      if (!played) {
        return socket.emit("error", { message: "Não encaixa! Tente o outro lado." })
      }
    }

    hand.splice(tileIndex, 1)

    if (hand.length === 0) {
      console.log("🏆 Vencedor:", socket.id, "Sala:", code)
      
      // 🔥 ATUALIZAR SALDO DA CASA (SE MONETIZAÇÃO ATIVA)
      if (adminSettings.monetizationEnabled) {
        houseBalance += adminSettings.houseFee
        transactions.push({
          id: uuid(),
          room: code,
          winner: socket.id,
          winnerShare: adminSettings.prize,
          houseShare: adminSettings.houseFee,
          timestamp: Date.now()
        })
        console.log('💰 Casa ganhou: R$', adminSettings.houseFee)
      }
      
      io.emit("gameOver", { winner: socket.id })
      delete rooms[code]
      sendRoomList()
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host

    socket.emit("tilePlayed", {
      hand: room.hands[socket.id],
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })

    io.emit("update", {
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })
  })

  // Comprar pedra
  socket.on("buyTile", ({ code }) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não encontrada" })
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })
    if (room.deck.length === 0) return socket.emit("error", { message: "Monte vazio!" })

    const tile = room.deck.pop()
    room.hands[socket.id].push(tile)

    console.log("🛒 Pedra comprada")

    socket.emit("tileBought", {
      hand: room.hands[socket.id],
      deckCount: room.deck.length,
      board: room.board
    })
  })

  // Passar vez
  socket.on("passTurn", ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id) return
    
    room.turn = room.turn === room.host ? room.guest : room.host
    
    io.emit("update", { 
      board: room.board, 
      turn: room.turn, 
      deckCount: room.deck.length 
    })
  })

  // Disconnect
  socket.on("disconnect", () => {
    console.log("❌ Disconnect:", socket.id)
    for (const code in rooms) {
      if (rooms[code].host === socket.id || rooms[code].guest === socket.id) {
        delete rooms[code]
      }
    }
    sendRoomList()
  })
})

// ============================================
// 🚀 INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000

server.listen(PORT, '0.0.0.0', () => {
  console.log("============================================")
  console.log("🚀 Servidor rodando na porta", PORT)
  console.log("🔐 Admin Panel: http://localhost:" + PORT + "/admin")
  console.log("🎮 Jogo: http://localhost:" + PORT)
  console.log("💰 Monetização:", adminSettings.monetizationEnabled ? '✅ ATIVADA' : '❌ DESATIVADA')
  console.log("============================================")
})
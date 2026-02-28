require("dotenv").config()

const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const { v4: uuid } = require("uuid")

const app = express()
app.use(express.json())
app.use(express.static("public"))

const server = http.createServer(app)

// ============================================
// 🔥 MERCADO PAGO - IMPORT CORRETO
// ============================================
let mercadopago = null
let mpConfigured = false

try {
  mercadopago = require("mercadopago")
  
  // Configurar apenas se tiver token
  if (process.env.MP_ACCESS_TOKEN && process.env.MP_ACCESS_TOKEN !== '') {
    mercadopago.configure({
      access_token: process.env.MP_ACCESS_TOKEN
    })
    mpConfigured = true
    console.log('✅ Mercado Pago configurado!')
  } else {
    console.log('⚠️ MP_ACCESS_TOKEN não configurado - Modo teste ativo')
  }
} catch (error) {
  console.log('⚠️ Mercado Pago não disponível - Modo teste ativo')
}

// ✅ CORS
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
let payments = {}

// ============================================
// 🔥 CONFIGURAÇÕES DO ADMIN
// ============================================
let adminSettings = {
  monetizationEnabled: false, // 🔥 PADRÃO DESATIVADO PARA TESTES
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
// 🔥 ROTAS DE PAGAMENTO PIX (SIMPLIFICADO)
// ============================================

app.post('/api/payment/create', async (req, res) => {
  const { userId, roomId, playerType } = req.body
  
  if (!userId || !roomId) {
    return res.status(400).json({ success: false, error: 'Dados inválidos' })
  }
  
  const transactionId = uuid()
  
  // 🔥 SEMPRE MODO TESTE SE NÃO TIVER MP CONFIGURADO
  if (!mpConfigured || !adminSettings.monetizationEnabled) {
    console.log('🧪 Modo teste - PIX simulado:', transactionId)
    
    payments[transactionId] = {
      id: transactionId,
      userId,
      roomId,
      playerType,
      amount: adminSettings.entryFee,
      status: 'approved',
      pixCode: 'MODO_TESTE',
      pixQRCode: '',
      createdAt: Date.now()
    }
    
    const room = rooms[roomId]
    if (room) {
      if (playerType === 'host') {
        room.hostPaid = true
        io.to(userId).emit("paymentConfirmed", { roomId })
      } else if (playerType === 'guest') {
        room.guestPaid = true
        io.to(userId).emit("paymentConfirmed", { roomId })
        if (room.host) io.to(room.host).emit("bothPaid", { roomId })
      }
    }
    
    return res.json({
      success: true,
      transactionId,
      pixCode: '00020126580014BR.GOV.BCB.PIX0136TESTE-MODO-DESENVOLVIMENTO520400005303986540410.005802BR5913SKILL_ARENA6008SAO_PAULO62070503***6304ABCD',
      pixQRCode: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      amount: adminSettings.entryFee,
      testMode: true,
      message: 'Modo teste - Pagamento aprovado automaticamente'
    })
  }
  
  // 🔥 PRODUÇÃO - Mercado Pago
  try {
    const preference = {
      transaction_amount: parseFloat(adminSettings.entryFee),
      description: `Entrada Sala ${roomId} - ${playerType}`,
      payment_method_id: 'pix',
      payer: { email: `${userId}@skillarena.com` },
      external_reference: transactionId,
      metadata: { userId, roomId, playerType }
    }
    
    console.log('💰 Criando PIX MP:', transactionId)
    
    const result = await mercadopago.payment.create(preference)
    
    let pixCode = ''
    let pixQRCode = ''
    
    if (result.body?.point_of_interaction?.transaction_data) {
      pixCode = result.body.point_of_interaction.transaction_data.ticket_url || ''
      pixQRCode = result.body.point_of_interaction.transaction_data.qr_code_base64 || ''
    }
    
    payments[transactionId] = {
      id: transactionId,
      userId,
      roomId,
      playerType,
      amount: adminSettings.entryFee,
      status: 'pending',
      pixCode,
      pixQRCode,
      createdAt: Date.now()
    }
    
    console.log('✅ PIX MP gerado:', transactionId)
    
    res.json({
      success: true,
      transactionId,
      pixCode,
      pixQRCode,
      amount: adminSettings.entryFee,
      testMode: false
    })
  } catch (error) {
    console.error('❌ Erro MP:', error.message)
    
    // Fallback para modo teste
    payments[transactionId] = {
      id: transactionId,
      userId,
      roomId,
      playerType,
      amount: adminSettings.entryFee,
      status: 'approved',
      pixCode: 'ERRO_MP_FALLBACK',
      pixQRCode: '',
      createdAt: Date.now()
    }
    
    res.json({
      success: true,
      transactionId,
      pixCode: 'MODO_TESTE_FALLBACK',
      pixQRCode: '',
      amount: adminSettings.entryFee,
      testMode: true,
      message: 'Erro no MP - Modo teste ativado'
    })
  }
})

app.get('/api/payment/status/:transactionId', (req, res) => {
  const { transactionId } = req.params
  const payment = payments[transactionId]
  
  if (!payment) {
    return res.status(404).json({ success: false, error: 'Transação não encontrada' })
  }
  
  res.json({
    success: true,
    status: payment.status,
    paid: payment.status === 'approved'
  })
})

app.post('/api/payment/webhook', async (req, res) => {
  const { action, data } = req.body
  console.log('📡 Webhook:', action, data)
  
  if (action === 'payment.created' || action === 'payment.updated') {
    try {
      if (mercadopago && mpConfigured) {
        const payment = await mercadopago.payment.get(data.id)
        const externalRef = payment.body.external_reference
        
        if (payments[externalRef]) {
          payments[externalRef].status = payment.body.status
          
          if (payment.body.status === 'approved') {
            const { roomId, userId, playerType } = payments[externalRef].metadata
            const room = rooms[roomId]
            
            if (room) {
              if (playerType === 'host') {
                room.hostPaid = true
                io.to(userId).emit("paymentConfirmed", { roomId })
              } else if (playerType === 'guest') {
                room.guestPaid = true
                io.to(userId).emit("paymentConfirmed", { roomId })
              }
              
              if (room.guestPaid && room.hostPaid) {
                io.to(room.host).emit("bothPaid", { roomId })
              }
            }
            
            transactions.push({
              id: externalRef,
              roomId,
              userId,
              amount: adminSettings.entryFee,
              status: 'approved',
              timestamp: Date.now()
            })
          }
        }
      }
      res.status(200).send('OK')
    } catch (error) {
      console.error('❌ Erro webhook:', error)
      res.status(500).send('Error')
    }
  } else {
    res.status(200).send('OK')
  }
})

// ============================================
// 🔥 ROTAS DE ADMIN
// ============================================
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html')
})

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body
  if (password === adminSettings.adminPassword) {
    const sessionId = uuid()
    adminSessions[sessionId] = { loggedIn: true, createdAt: Date.now() }
    res.json({ success: true, sessionId })
  } else {
    res.status(401).json({ success: false, error: 'Senha incorreta' })
  }
})

app.get('/api/admin/settings', (req, res) => {
  res.json({
    monetizationEnabled: adminSettings.monetizationEnabled,
    entryFee: adminSettings.entryFee,
    prize: adminSettings.prize,
    houseFee: adminSettings.houseFee
  })
})

app.post('/api/admin/settings', (req, res) => {
  const { sessionId, monetizationEnabled } = req.body
  if (!adminSessions[sessionId]) {
    return res.status(401).json({ success: false, error: 'Não autorizado' })
  }
  adminSettings.monetizationEnabled = monetizationEnabled === true
  console.log('💰 Monetização:', adminSettings.monetizationEnabled ? '✅ ATIVADA' : '❌ DESATIVADA')
  io.emit('monetizationStatus', { enabled: adminSettings.monetizationEnabled })
  res.json({ success: true, settings: adminSettings })
})

app.get('/api/admin/data', (req, res) => {
  res.json({
    houseBalance,
    rooms: Object.values(rooms),
    transactions,
    settings: adminSettings,
    payments: Object.values(payments)
  })
})

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

  socket.on("register", (username) => {
    users[socket.id] = { username }
    socket.emit("registered", { id: socket.id, username })
  })

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
    console.log("🏠 Sala criada:", code)
    
    if (adminSettings.monetizationEnabled && mpConfigured) {
      socket.emit("paymentRequired", {
        amount: adminSettings.entryFee,
        roomId: code,
        userId: socket.id,
        playerType: 'host'
      })
    } else {
      rooms[code].hostPaid = true
      socket.emit("roomCreated", { code })
    }
    sendRoomList()
  })

  socket.on("joinRoom", (code) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não existe" })
    if (room.started) return socket.emit("error", { message: "Jogo já começou" })
    if (room.guest) return socket.emit("error", { message: "Sala cheia" })
    if (room.host === socket.id) return socket.emit("error", { message: "Você já é o host!" })

    room.guest = socket.id
    console.log("👤 Guest entrou:", code)

    if (adminSettings.monetizationEnabled && mpConfigured) {
      socket.emit("paymentRequired", {
        amount: adminSettings.entryFee,
        roomId: code,
        userId: socket.id,
        playerType: 'guest'
      })
      return
    }
    
    room.guestPaid = true
    io.to(room.host).emit("guestJoined", { code, guestId: socket.id })
    io.to(room.host).emit("bothPaid", { code })
    socket.emit("roomJoined", { code })
    sendRoomList()
  })

  socket.on("startGame", (code) => {
    const room = rooms[code]
    if (!room) return
    if (room.host !== socket.id) return socket.emit("error", { message: "Apenas host pode iniciar" })
    if (!room.guest) return socket.emit("error", { message: "Aguarde o convidado" })
    if (adminSettings.monetizationEnabled && (!room.hostPaid || !room.guestPaid)) {
      return socket.emit("error", { message: "Ambos devem pagar!" })
    }
    if (room.started) return

    room.started = true
    const deck = generateDeck()
    room.deck = deck.slice(14)
    room.hands = { [room.host]: deck.slice(0, 7), [room.guest]: deck.slice(7, 14) }
    room.board = []
    room.turn = room.host

    io.to(room.host).emit("gameStart", { hand: room.hands[room.host], isHost: true, deckCount: room.deck.length })
    io.to(room.guest).emit("gameStart", { hand: room.hands[room.guest], isHost: false, deckCount: room.deck.length })
    io.emit("update", { board: [], turn: room.turn, deckCount: room.deck.length })
  })

  socket.on("play", ({ code, tile, side }) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não encontrada" })
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })

    const hand = room.hands[socket.id]
    if (!hand) return socket.emit("error", { message: "Mão não encontrada" })

    const tile0 = Number(tile[0]), tile1 = Number(tile[1])
    const tileIndex = hand.findIndex(t => Number(t[0]) === tile0 && Number(t[1]) === tile1)
    if (tileIndex === -1) return socket.emit("error", { message: "Você não tem esta pedra!" })

    if (room.board.length === 0) {
      room.board.push([tile0, tile1])
    } else {
      const left = room.board[0][0], right = room.board[room.board.length - 1][1]
      let played = false

      if (side === "left") {
        if (tile1 === left) { room.board.unshift([tile0, tile1]); played = true }
        else if (tile0 === left) { room.board.unshift([tile1, tile0]); played = true }
      }
      if (side === "right" && !played) {
        if (tile0 === right) { room.board.push([tile0, tile1]); played = true }
        else if (tile1 === right) { room.board.push([tile1, tile0]); played = true }
      }
      if (!played) return socket.emit("error", { message: "Não encaixa!" })
    }

    hand.splice(tileIndex, 1)

    if (hand.length === 0) {
      if (adminSettings.monetizationEnabled) {
        houseBalance += adminSettings.houseFee
        transactions.push({ id: uuid(), room: code, winner: socket.id, winnerShare: adminSettings.prize, houseShare: adminSettings.houseFee, timestamp: Date.now() })
      }
      io.emit("gameOver", { winner: socket.id })
      delete rooms[code]
      sendRoomList()
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host
    socket.emit("tilePlayed", { hand: room.hands[socket.id], board: room.board, turn: room.turn, deckCount: room.deck.length })
    io.emit("update", { board: room.board, turn: room.turn, deckCount: room.deck.length })
  })

  socket.on("buyTile", ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id || room.deck.length === 0) return socket.emit("error", { message: "Erro ao comprar" })
    const tile = room.deck.pop()
    room.hands[socket.id].push(tile)
    socket.emit("tileBought", { hand: room.hands[socket.id], deckCount: room.deck.length, board: room.board })
  })

  socket.on("passTurn", ({ code }) => {
    const room = rooms[code]
    if (!room || room.turn !== socket.id) return
    room.turn = room.turn === room.host ? room.guest : room.host
    io.emit("update", { board: room.board, turn: room.turn, deckCount: room.deck.length })
  })

  socket.on("disconnect", () => {
    console.log("❌ Disconnect:", socket.id)
    for (const code in rooms) {
      if (rooms[code].host === socket.id || rooms[code].guest === socket.id) delete rooms[code]
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
  console.log("🔐 Admin: http://localhost:" + PORT + "/admin")
  console.log("🎮 Jogo: http://localhost:" + PORT)
  console.log("💰 Monetização:", adminSettings.monetizationEnabled ? '✅ ATIVADA' : '❌ DESATIVADA')
  console.log("📡 MP Configurado:", mpConfigured ? '✅ SIM' : '⚠️ NÃO (Modo teste)')
  console.log("============================================")
})
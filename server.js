require("dotenv").config()

const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const { v4: uuid } = require("uuid")

const app = express()
app.use(express.json())
app.use(express.static("public"))

const server = http.createServer(app)
const io = new Server(server)

let rooms = {}
let users = {}

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
    hostId: r.host
  }))
  io.emit("roomList", list)
}

io.on("connection", (socket) => {
  console.log("🔌 Conectado:", socket.id)
  sendRoomList()

  socket.on("register", (username) => {
    users[socket.id] = { username }
    socket.emit("registered", { id: socket.id, username })
    console.log("✅ Usuário registrado:", username)
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
      started: false
    }
    console.log("🏠 Sala criada:", code, "Host:", socket.id)
    socket.emit("roomCreated", { code })
    sendRoomList()
  })

  socket.on("joinRoom", (code) => {
    const room = rooms[code]
    console.log("🚪 Tentando entrar na sala:", code)
    console.log("📋 Salas existentes:", Object.keys(rooms))
    
    if (!room) {
      console.log("❌ Sala não encontrada:", code)
      return socket.emit("error", { message: "Sala não existe" })
    }
    if (room.started) return socket.emit("error", { message: "Jogo já começou" })
    if (room.guest) return socket.emit("error", { message: "Sala cheia" })
    if (room.host === socket.id) return socket.emit("error", { message: "Você é o host!" })

    room.guest = socket.id
    console.log("👤 Guest entrou:", code)

    io.to(room.host).emit("guestJoined", { code })
    socket.emit("roomJoined", { code })
    sendRoomList()
  })

  socket.on("startGame", (code) => {
    const room = rooms[code]
    console.log("🚀 Iniciando jogo na sala:", code)
    
    if (!room) {
      console.log("❌ Sala não encontrada:", code)
      return socket.emit("error", { message: "Sala não encontrada" })
    }
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
      deckCount: room.deck.length
    })

    io.to(room.guest).emit("gameStart", {
      hand: room.hands[room.guest],
      deckCount: room.deck.length
    })

    io.emit("update", { board: [], turn: room.turn, deckCount: room.deck.length })
  })

  socket.on("play", ({ code, tile, side }) => {
    const room = rooms[code]
    console.log("🎲 Jogada recebida - Sala:", code, "Pedra:", tile, "Lado:", side)
    
    if (!room) {
      console.log("❌ Sala não encontrada:", code)
      return socket.emit("error", { message: "Sala não encontrada" })
    }
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })

    const hand = room.hands[socket.id]
    if (!hand) return socket.emit("error", { message: "Mão não encontrada" })

    const t0 = parseInt(tile[0])
    const t1 = parseInt(tile[1])

    const idx = hand.findIndex(t => parseInt(t[0]) === t0 && parseInt(t[1]) === t1)
    if (idx === -1) return socket.emit("error", { message: "Pedra não encontrada!" })

    // 🔥 PRIMEIRA PEDRA - HORIZONTAL
    if (room.board.length === 0) {
      room.board.push({
        values: [t0, t1],
        rotation: 'horizontal'
      })
      console.log("✅ Primeira pedra (horizontal):", [t0, t1])
    } else {
      const left = room.board[0].values[0]
      const right = room.board[room.board.length - 1].values[1]
      let played = false

      // 🔥 ROTAÇÃO: VERTICAL A CADA 5 PEDRAS PARA FAZER A CURVA
      const shouldRotate = room.board.length > 0 && room.board.length % 5 === 0

      if (side === "left") {
        if (t1 === left) {
          room.board.unshift({
            values: [t0, t1],
            rotation: shouldRotate ? 'vertical' : 'horizontal'
          })
          played = true
          console.log("✅ Esquerda:", [t0, t1], "Rotação:", shouldRotate ? 'vertical' : 'horizontal')
        } else if (t0 === left) {
          room.board.unshift({
            values: [t1, t0],
            rotation: shouldRotate ? 'vertical' : 'horizontal'
          })
          played = true
          console.log("✅ Esquerda (invertida):", [t1, t0], "Rotação:", shouldRotate ? 'vertical' : 'horizontal')
        }
      }

      if (side === "right" && !played) {
        if (t0 === right) {
          room.board.push({
            values: [t0, t1],
            rotation: shouldRotate ? 'vertical' : 'horizontal'
          })
          played = true
          console.log("✅ Direita:", [t0, t1], "Rotação:", shouldRotate ? 'vertical' : 'horizontal')
        } else if (t1 === right) {
          room.board.push({
            values: [t1, t0],
            rotation: shouldRotate ? 'vertical' : 'horizontal'
          })
          played = true
          console.log("✅ Direita (invertida):", [t1, t0], "Rotação:", shouldRotate ? 'vertical' : 'horizontal')
        }
      }

      if (!played) return socket.emit("error", { message: "Não encaixa!" })
    }

    hand.splice(idx, 1)
    console.log("✅ Pedra jogada. Restam:", hand.length)

    if (hand.length === 0) {
      console.log("🏆 Vencedor:", socket.id)
      io.emit("gameOver", { winner: socket.id })
      delete rooms[code]
      sendRoomList()
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host
    console.log("🔄 Vez passada para:", room.turn)

    socket.emit("tilePlayed", {
      hand: room.hands[socket.id],
      board: room.board,
      turn: room.turn,
      deckCount: room.deck.length
    })

    io.emit("update", { board: room.board, turn: room.turn, deckCount: room.deck.length })
  })

  socket.on("buyTile", ({ code }) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não encontrada" })
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })
    if (room.deck.length === 0) return socket.emit("error", { message: "Monte vazio!" })

    room.hands[socket.id].push(room.deck.pop())
    console.log("🛒 Pedra comprada")

    socket.emit("tileBought", {
      hand: room.hands[socket.id],
      deckCount: room.deck.length,
      board: room.board
    })
  })

  socket.on("disconnect", () => {
    console.log("❌ Disconnect:", socket.id)
    for (const code in rooms) {
      if (rooms[code].host === socket.id || rooms[code].guest === socket.id) {
        console.log("🗑️ Deletando sala:", code)
        delete rooms[code]
      }
    }
    sendRoomList()
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, '0.0.0.0', () => {
  console.log("🚀 Servidor rodando na porta " + PORT)
})
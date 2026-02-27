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

io.on("connection", (socket) => {
  console.log("🔌 Conectado:", socket.id)

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
      direction: 'right' // 🔥 DIREÇÃO ATUAL DO JOGO
    }
    console.log("🏠 Sala criada:", code)
    socket.emit("roomCreated", { code })
  })

  socket.on("joinRoom", (code) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não existe" })
    if (room.guest) return socket.emit("error", { message: "Sala cheia" })
    if (room.host === socket.id) return socket.emit("error", { message: "Você é o host!" })

    room.guest = socket.id
    console.log("👤 Guest entrou:", code)

    io.to(room.host).emit("guestJoined", { code })
    socket.emit("roomJoined", { code })
  })

  socket.on("startGame", (code) => {
    const room = rooms[code]
    if (!room || room.host !== socket.id || !room.guest) return

    room.started = true
    const deck = generateDeck()
    room.deck = deck.slice(14)
    room.hands = {
      [room.host]: deck.slice(0, 7),
      [room.guest]: deck.slice(7, 14)
    }
    room.board = []
    room.turn = room.host
    room.direction = 'right'

    console.log("🎮 Jogo iniciado!")

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

  // 🔥 LÓGICA DE ROTAÇÃO DAS PEDRAS
  socket.on("play", ({ code, tile, side }) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não encontrada" })
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })

    const hand = room.hands[socket.id]
    const t0 = parseInt(tile[0])
    const t1 = parseInt(tile[1])

    const idx = hand.findIndex(t => parseInt(t[0]) === t0 && parseInt(t[1]) === t1)
    if (idx === -1) return socket.emit("error", { message: "Pedra não encontrada!" })

    let pieceData = {
      values: [t0, t1],
      rotation: 'horizontal' // 🔥 ROTAÇÃO: 'horizontal' ou 'vertical'
    }

    if (room.board.length === 0) {
      // 🔥 PRIMEIRA PEDRA - HORIZONTAL
      room.board.push(pieceData)
      room.direction = 'right'
    } else {
      const left = room.board[0].values[0]
      const right = room.board[room.board.length - 1].values[1]
      let played = false

      // 🔥 JOGAR NA ESQUERDA
      if (side === "left") {
        if (t1 === left) {
          pieceData.values = [t0, t1]
          // 🔥 VERTICAL SE MUDAR DIREÇÃO
          pieceData.rotation = (room.direction === 'up' || room.direction === 'down') ? 'vertical' : 'horizontal'
          room.board.unshift(pieceData)
          played = true
        } else if (t0 === left) {
          pieceData.values = [t1, t0]
          pieceData.rotation = (room.direction === 'up' || room.direction === 'down') ? 'vertical' : 'horizontal'
          room.board.unshift(pieceData)
          played = true
        }
      }

      // 🔥 JOGAR NA DIREITA
      if (side === "right" && !played) {
        if (t0 === right) {
          pieceData.values = [t0, t1]
          pieceData.rotation = (room.direction === 'up' || room.direction === 'down') ? 'vertical' : 'horizontal'
          room.board.push(pieceData)
          played = true
        } else if (t1 === right) {
          pieceData.values = [t1, t0]
          pieceData.rotation = (room.direction === 'up' || room.direction === 'down') ? 'vertical' : 'horizontal'
          room.board.push(pieceData)
          played = true
        }
      }

      if (!played) return socket.emit("error", { message: "Não encaixa!" })
    }

    hand.splice(idx, 1)
    console.log("✅ Pedra jogada. Restam:", hand.length)

    if (hand.length === 0) {
      console.log("🏆 Vencedor!")
      io.emit("gameOver", { winner: socket.id })
      delete rooms[code]
      return
    }

    room.turn = room.turn === room.host ? room.guest : room.host

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
    if (!room || room.turn !== socket.id || room.deck.length === 0) return

    room.hands[socket.id].push(room.deck.pop())
    console.log("🛒 Pedra comprada")

    socket.emit("tileBought", {
      hand: room.hands[socket.id],
      deckCount: room.deck.length,
      board: room.board
    })
  })

  socket.on("disconnect", () => {
    for (const code in rooms) {
      if (rooms[code].host === socket.id || rooms[code].guest === socket.id) {
        delete rooms[code]
      }
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, '0.0.0.0', () => {
  console.log("🚀 Servidor rodando na porta " + PORT)
})
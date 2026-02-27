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

    console.log("🎮 Jogo iniciado!")

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

  socket.on("buyTile", ({ code }) => {
    const room = rooms[code]
    if (!room) return socket.emit("error", { message: "Sala não encontrada" })
    if (room.turn !== socket.id) return socket.emit("error", { message: "Não é sua vez!" })
    if (room.deck.length === 0) return socket.emit("error", { message: "Monte vazio!" })

    const tile = room.deck.pop()
    room.hands[socket.id].push(tile)

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
    sendRoomList()
  })
})

// ✅ PORTA CORRIGIDA PARA RAILWAY
const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta", PORT)
})

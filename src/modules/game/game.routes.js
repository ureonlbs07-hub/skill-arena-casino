const express = require('express')
const router = express.Router()
const gameService = require('./game.service')

router.get('/rooms', async (req, res) => {
  const rooms = await gameService.getActiveRooms()
  res.json({ success: true, rooms })
})

router.get('/rooms/:code', async (req, res) => {
  const room = await gameService.getRoom(req.params.code)
  if (!room) {
    return res.status(404).json({ success: false, error: 'Sala não encontrada' })
  }
  res.json({ success: true, room })
})

module.exports = router
function generateCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
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

function formatCurrency(value) {
  return parseFloat(value).toFixed(2).replace('.', ',')
}

module.exports = {
  generateCode,
  generateDeck,
  formatCurrency
}
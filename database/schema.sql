-- ============================================
-- 🎲 SKILL ARENA - BANCO DE DADOS
-- ============================================

-- Usuários
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  pix_key VARCHAR(255),
  balance DECIMAL(10,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Salas
CREATE TABLE IF NOT EXISTS rooms (
  code VARCHAR(10) PRIMARY KEY,
  host_id VARCHAR(50) REFERENCES users(id),
  guest_id VARCHAR(50) REFERENCES users(id),
  host_paid BOOLEAN DEFAULT FALSE,
  guest_paid BOOLEAN DEFAULT FALSE,
  started BOOLEAN DEFAULT FALSE,
  ended BOOLEAN DEFAULT FALSE,
  winner_id VARCHAR(50) REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);

-- Transações
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) REFERENCES users(id),
  room_code VARCHAR(10) REFERENCES rooms(code),
  amount DECIMAL(10,2) NOT NULL,
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  pix_code TEXT,
  pix_qr_code TEXT,
  mp_payment_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);

-- Configurações do Admin
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserir configurações padrão
INSERT INTO settings (key, value) VALUES 
  ('monetization_enabled', 'false'),
  ('entry_fee', '10.00'),
  ('prize', '17.00'),
  ('house_fee', '3.00')
ON CONFLICT (key) DO NOTHING;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_room ON transactions(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_rooms_guest ON rooms(guest_id);
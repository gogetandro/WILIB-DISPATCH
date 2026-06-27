-- ========================================
-- WILIB Massachusetts — Database Schema
-- Sistèm Rezèvasyon Sèlman (20+ mil)
-- Kole tout kòd sa nan Supabase → SQL Editor → Run
-- ========================================

-- 1. CHOFÈ
CREATE TABLE drivers (
  id          BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  city        TEXT NOT NULL,
  lat         FLOAT NOT NULL,
  lng         FLOAT NOT NULL,
  vehicle     TEXT NOT NULL,
  capacity    INT DEFAULT 7,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. REZÈVASYON
CREATE TABLE reservations (
  id           BIGSERIAL PRIMARY KEY,
  client_name  TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  from_city    TEXT NOT NULL,
  from_lat     FLOAT,
  from_lng     FLOAT,
  to_city      TEXT NOT NULL,
  passengers   INT DEFAULT 1,
  trip_date    TEXT NOT NULL,
  trip_time    TEXT NOT NULL,
  status       TEXT DEFAULT 'pending'
               CHECK (status IN ('pending','dispatched','confirmed','cancelled')),
  driver_id    BIGINT REFERENCES drivers(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 3. DISPATCH LOG
CREATE TABLE dispatch_log (
  id             BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT REFERENCES reservations(id),
  driver_id      BIGINT REFERENCES drivers(id),
  action         TEXT NOT NULL CHECK (action IN ('sent','accepted','declined','timeout')),
  created_at     TIMESTAMP DEFAULT NOW()
);

-- INDEX
CREATE INDEX idx_drivers_status ON drivers(status);
CREATE INDEX idx_drivers_tg     ON drivers(telegram_id);
CREATE INDEX idx_res_status     ON reservations(status);

-- SECURITY
ALTER TABLE drivers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wilib_drivers"      ON drivers      FOR ALL USING (true);
CREATE POLICY "wilib_reservations" ON reservations FOR ALL USING (true);
CREATE POLICY "wilib_dispatch_log" ON dispatch_log FOR ALL USING (true);

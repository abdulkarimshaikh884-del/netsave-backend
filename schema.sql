-- ===================================================
-- NetSave Supabase Schema
-- Run this in Supabase SQL Editor
-- ===================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    photo_url TEXT,
    coins INTEGER DEFAULT 100,
    total_data_saved_mb NUMERIC(12,4) DEFAULT 0,
    referral_code VARCHAR(50) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Browser History
CREATE TABLE IF NOT EXISTS browser_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title VARCHAR(255),
    domain VARCHAR(255),
    saved_kb INTEGER DEFAULT 0,
    visited_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily Streaks
CREATE TABLE IF NOT EXISTS daily_streaks (
    user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_check_in DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Coins Transactions
CREATE TABLE IF NOT EXISTS coins_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_history_user ON browser_history(user_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_coins_user ON coins_transactions(user_id);

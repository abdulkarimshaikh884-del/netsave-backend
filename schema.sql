-- ===================================================
-- NetSave Supabase/PostgreSQL Database Schema
-- Run this script in your Supabase SQL Editor
-- ===================================================

-- Enable UUID extension (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY, -- Matches the Supabase Auth user ID (UUID as string)
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    photo_url TEXT,
    coins INTEGER DEFAULT 100, -- Welcome bonus coins
    total_data_saved_mb NUMERIC(12, 4) DEFAULT 0.0000,
    referral_code VARCHAR(50) UNIQUE,
    referred_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. BROWSER HISTORY TABLE
CREATE TABLE IF NOT EXISTS browser_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title VARCHAR(255),
    favicon TEXT,
    domain VARCHAR(255),
    original_size_kb INTEGER DEFAULT 0,
    compressed_size_kb INTEGER DEFAULT 0,
    saved_kb INTEGER DEFAULT 0,
    session_id VARCHAR(255),
    duration INTEGER DEFAULT 0, -- Duration spent on page in seconds
    visited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. DAILY STREAKS TABLE
CREATE TABLE IF NOT EXISTS daily_streaks (
    user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_check_in DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. COINS TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS coins_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- positive for credit, negative for debit
    type VARCHAR(50) NOT NULL, -- 'welcome_bonus', 'daily_check_in', 'ad_reward', 'referral', 'redeem'
    description TEXT,
    status VARCHAR(50) DEFAULT 'completed', -- 'pending', 'completed', 'failed' (useful for coin redemption)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_browser_history_user_visited ON browser_history(user_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_history_domain ON browser_history(domain);
CREATE INDEX IF NOT EXISTS idx_coins_transactions_user ON coins_transactions(user_id);

-- 6. AUTOMATIC UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to users table
DROP TRIGGER IF EXISTS set_timestamp_users ON users;
CREATE TRIGGER set_timestamp_users
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Apply updated_at trigger to daily_streaks table
DROP TRIGGER IF EXISTS set_timestamp_daily_streaks ON daily_streaks;
CREATE TRIGGER set_timestamp_daily_streaks
BEFORE UPDATE ON daily_streaks
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

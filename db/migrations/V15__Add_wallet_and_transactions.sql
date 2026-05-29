SET timezone = 'Asia/Bangkok';

-- Add balances to users table
ALTER TABLE users ADD COLUMN available_balance NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN frozen_balance NUMERIC DEFAULT 0;

-- Create Enums for Transactions
CREATE TYPE transaction_status_enum AS ENUM ('pending', 'success', 'failed', 'cancelled');
CREATE TYPE transaction_type_enum AS ENUM ('top_up', 'freeze', 'release', 'refund');

-- Create Transactions Table
CREATE TABLE transactions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type transaction_type_enum NOT NULL,
    status transaction_status_enum NOT NULL,
    amount_coin NUMERIC NOT NULL,
    amount_vnd NUMERIC,
    order_code BIGINT,
    checkout_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_order_code ON transactions(order_code);

-- Add pending withdrawal balance to users
ALTER TABLE users ADD COLUMN pending_withdrawal NUMERIC DEFAULT 0;

-- Add bank info columns to users (for withdrawal payouts)
ALTER TABLE users ADD COLUMN bank_name TEXT;
ALTER TABLE users ADD COLUMN bank_account_number TEXT;
ALTER TABLE users ADD COLUMN bank_account_holder TEXT;

-- Extend transaction type enum with withdrawal
ALTER TYPE transaction_type_enum ADD VALUE 'withdrawal';

-- Create withdrawal status enum
CREATE TYPE withdrawal_status_enum AS ENUM ('pending', 'completed', 'rejected');

-- Create Withdrawal Requests Table
CREATE TABLE withdrawal_requests (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_coin NUMERIC NOT NULL,
    amount_vnd NUMERIC NOT NULL,
    status withdrawal_status_enum NOT NULL DEFAULT 'pending',
    idempotency_key TEXT NOT NULL UNIQUE,
    bank_name TEXT NOT NULL,
    bank_account_number TEXT NOT NULL,
    bank_account_holder TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdrawal_requests_user_id ON withdrawal_requests(user_id);


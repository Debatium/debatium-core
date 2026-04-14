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

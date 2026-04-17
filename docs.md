# Debatium Systems Documentation

## Virtual Coin & Wallet System

### Overview
Debatium integrates a virtual Coin system allows Debaters to purchase coins and use them to join Spars. Judges can earn these coins by submitting their ballots. The system ensures safe handling of user funds using a secure Freeze, Release, and Refund mechanism.

### PayOS Integration
Users top up their balance via **PayOS**. 
Available packages:
- **PKG_50**: 50 Coins for 50,000 VND
- **PKG_100**: 100 Coins for 100,000 VND
- **PKG_200**: 220 Coins for 200,000 VND
- **PKG_500**: 575 Coins for 500,000 VND

**Flow:**
1. User requests a top-up (`POST /wallet/top-up`) with a package ID.
2. The server creates a `Transaction` (status: `pending`) and generates a PayOS link.
3. The user makes the payment on PayOS.
4. PayOS sends a webhook to our server (`POST /payment/payos`).
5. The server validates the webhook signature, upgrades the `Transaction` status to `success`, and distributes the Coins to the user's `available_balance`.

### Spar Fee Mechanics (`10 coins` per Debater)
To guarantee Judges get paid upon completing the evaluation, Debatium holds debater funds during the actual Spar lifecycle:

1. **Freeze (Tạm giữ)**
   - When a Debater books a Spar, 10 coins are immediately deducted from `available_balance` and transitioned to `frozen_balance`.
2. **Release (Giải ngân)**
   - Once the Judge submits their Ballot during the evaluation phase, the 10 coins from every participating debater's `frozen_balance` are deducted and transitioned into the Judge's `available_balance`.
   - The platform takes a fixed **15% cut** before allocating the coins completely to the judge.
3. **Refund (Hoàn tiền)**
   - If a Spar gets cancelled by the Host, or if a Debater gets declined from joining, the 10 coins are refunded from their `frozen_balance` back to their `available_balance`.

### Database Design
- **`users` Table Extensions:** `available_balance`, `frozen_balance`.
- **`transactions` Table:** Auditing system that tracks all requests (`top_up`, `freeze`, `release`, `refund`).

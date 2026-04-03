# Debatium Core

TypeScript/Express backend API for the Debatium debate sparring platform.

## Architecture

```
debatium-core/
├── server.ts                 # Entry point
├── app.ts                    # Express app setup
├── config.ts                 # Environment configuration
├── swagger.ts                # OpenAPI spec
│
├── routes/                   # API routes + business logic
│   ├── auth/                 #   POST /auth/register, /login, /logout, /refresh
│   ├── users/                #   GET/PUT /users/profile, /search, /calendar
│   └── spars/                #   CRUD /spars/ (create, join, invite, leave, etc.)
│
├── db/                       # Domain models + database queries
│   ├── users/                #   User, Availability value objects + SQL
│   ├── tournaments/          #   Tournament, JudgeDetails, DebaterDetails + SQL
│   ├── spars/                #   Spar, SparMember + SQL
│   └── exceptions.ts         #   DomainValidationError
│
├── middleware/               # Express middleware
│   ├── requireAuth.ts        #   JWT Bearer token validation
│   ├── cors.ts               #   CORS (localhost:3000, 5173)
│   ├── validateJson.ts       #   JSON field whitelist validation
│   └── validateRequest.ts    #   Global request validation
│
├── extensions/               # External service clients
│   ├── db.ts                 #   PostgreSQL pool (pg)
│   └── redis.ts              #   Upstash Redis client
│
└── utils/                    # Utilities
    ├── jwt.ts                #   JWT sign/verify (access 15m, refresh 7d)
    ├── errors.ts             #   Error codes + response helper
    └── logger.ts             #   Pino logger
```

## Prerequisites

- Node.js 18+
- Supabase account (or local PostgreSQL)
- Upstash Redis account

## Getting Started

```bash
# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Edit .env with your database and Redis credentials

# Start development server
npm run dev
```

The server starts at **http://localhost:4000**.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MODE` | `dev` / `prod` / `testing` |
| `PORT` | Server port (default: 4000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |
| `JWT_ACCESS_SECRET` | Secret for access tokens |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens |

## API Documentation (Swagger)

Once the server is running, open:

- **Swagger UI:** http://localhost:4000/docs
- **OpenAPI JSON:** http://localhost:4000/docs.json

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register new user |
| POST | `/auth/login` | No | Login (returns JWT tokens + user) |
| POST | `/auth/refresh` | No | Refresh access token |
| POST | `/auth/logout` | Yes | Invalidate refresh token |
| GET | `/users/profile` | Yes | Get own profile |
| PUT | `/users/profile` | Yes | Update profile |
| GET | `/users/search?q=` | No | Search users |
| GET | `/users/:username` | No | Public profile |
| GET/POST/PUT/DELETE | `/users/calendar` | Yes | Calendar availability CRUD |
| GET | `/users/calendar-link` | Yes | Get iCal subscription links |
| POST | `/spars/` | Yes | Create spar |
| GET | `/spars/` | Optional | List available spars |
| GET | `/spars/me` | Yes | My active spars |
| GET | `/spars/me/history` | Yes | My past spars |
| POST | `/spars/request` | Yes | Request to join |
| POST | `/spars/invite` | Yes | Invite user (host only) |
| POST | `/spars/matching` | Yes | Start matching (host only) |
| POST | `/spars/cancel-matching` | Yes | Cancel matching (host only) |
| POST | `/spars/accept` | Yes | Accept request/invite |
| POST | `/spars/decline` | Yes | Decline request/invite |
| POST | `/spars/leave` | Yes | Leave spar |
| POST | `/spars/kick` | Yes | Kick member (host only) |
| DELETE | `/spars/` | Yes | Cancel spar (host only) |

## Authentication

Uses JWT tokens:
- **Access token** (15 min) -- sent as `Authorization: Bearer <token>` header
- **Refresh token** (7 days) -- stored in Redis, exchanged via `POST /auth/refresh`

Login response:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": "...",
    "fullName": "...",
    "username": "...",
    "email": "...",
    "avatarURL": "1"
  }
}
```

## Database

- Hosted on **Supabase** (PostgreSQL)
- View tables via **pgAdmin** or **Supabase Dashboard**
- Migrations in `db/migrations/`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run migrate` | Run database migrations |

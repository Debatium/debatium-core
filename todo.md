### DONE

Area	Details
App setup	Express app, middleware, health check, error handler
Config	Environment variables, DB/Redis URLs
Extensions	PostgreSQL pool (db.ts), Redis client (redis.ts)
Middleware	requireAuth, cors, validateRequest, validateJson
Auth	Login/logout routes + services (session management)
Utils	Error codes/enums, logger

### TODO
Area	Backend (Python)	Core (TS)
Users routes	10 endpoints (register, update, search, profile, calendar CRUD, calendar links)	Skeleton — all TODO
Users services	Full service layer (registration, profile updates, availability, calendar links)	Empty
Users domain	Value objects with validation (FullName, Username, Password, Email, etc.), User aggregate	Empty TODO list
Users queries	11 DB query functions	Empty TODO list
Spars routes	12 endpoints (create, list, request, invite, match, accept, decline, leave, kick, cancel)	Empty skeleton
Spars services	Full service layer for all spar operations	Empty
Spars domain	SparStatus, SparRole, Spar, SparMember etc.	Empty
Spars queries	Full DB query layer	Empty
Calendar module	iCal generation endpoint	Entirely missing
Tournaments domain	TournamentRule, TournamentScale, Tournament, TournamentEntry etc.	Empty
Tournaments queries	Full query layer	Empty
Profiling utils	Request profiling (DB queries, Redis calls, timing)	Missing
DB migrations	6 migration files (users, tournaments, availabilities, spars, matching algorithms)	N/A (shared)
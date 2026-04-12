import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Debatium API",
      version: "1.0.0",
      description: "Debatium core backend API",
    },
    servers: [{ url: "http://localhost:4000", description: "Development" }],
    components: {
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "INVALID_FIELD_VALUE" },
                message: { type: "string" },
              },
            },
          },
        },
        Success: {
          type: "object",
          properties: {
            success: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
            },
          },
        },
        TournamentEntry: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string", example: "WUDC" },
            year: { type: "string", example: "2025" },
            scale: { type: "string", example: "100" },
            rule: { type: "string", enum: ["bp", "wsdc"] },
            role: {
              type: "string",
              enum: [
                "debater",
                "independentAdjudicator",
                "subsidizedAdjudicator",
                "invitedAdjudicator",
              ],
            },
            debaterDetails: {
              type: "object",
              properties: {
                breakingRank: { type: "string" },
                achievement: {
                  type: "string",
                  enum: [
                    "participant",
                    "octoFinalist",
                    "quarterFinalist",
                    "semiFinalist",
                    "finalist",
                    "champion",
                    "runnerUp",
                  ],
                },
              },
            },
            judgeDetails: {
              type: "object",
              properties: {
                rounds: { type: "string" },
                highestRank: {
                  type: "string",
                  enum: ["trainee", "panel", "chair"],
                },
              },
            },
          },
        },
        UserProfile: {
          type: "object",
          properties: {
            id: { type: "string" },
            fullName: { type: "string" },
            username: { type: "string" },
            email: { type: "string" },
            institution: { type: "string", nullable: true },
            debaterLevel: { type: "string", enum: ["novice", "open", "pro"] },
            judgeLevel: {
              type: "string",
              enum: ["novice", "intermediate", "advanced", "expert"],
            },
            avatarURL: { type: "string" },
            tournamentEntries: {
              type: "array",
              items: { $ref: "#/components/schemas/TournamentEntry" },
            },
          },
        },
        SparMember: {
          type: "object",
          properties: {
            userId: { type: "string" },
            fullName: { type: "string" },
            username: { type: "string" },
            avatarURL: { type: "integer" },
            judgeLevel: { type: "string" },
            debaterLevel: { type: "string" },
            role: { type: "string", enum: ["debater", "judge", "observer"] },
            isHost: { type: "boolean" },
            status: {
              type: "string",
              enum: ["pending", "accepted", "declined", "invited"],
            },
          },
        },
        Spar: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            time: { type: "string", example: "10/04/2026 20:00" },
            rule: { type: "string", enum: ["bp", "wsdc"] },
            status: { type: "string", enum: ["created", "matching", "ready", "debating", "evaluating", "done", "cancelled"] },
            expectedDebaterLevel: { type: "string", enum: ["novice", "open", "pro"] },
            expectedJudgeLevel: { type: "string", nullable: true },
            expectingJudge: { type: "boolean" },
            motion: { type: "string", nullable: true },
            meetLink: { type: "string", nullable: true },
            prepLinks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  team: { type: "string" },
                  link: { type: "string" },
                },
              },
            },
            members: {
              type: "array",
              items: { $ref: "#/components/schemas/SparMember" },
            },
            isHost: { type: "boolean", nullable: true },
            memberCount: { type: "integer" },
          },
        },
        Notification: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            eventType: {
              type: "string",
              enum: [
                "INVITE_RECEIVED",
                "JOIN_REQUEST_RECEIVED",
                "REQUEST_DECISION",
                "MEETING_READY",
                "SPAR_CANCELLED",
                "ASSIGNED_AS_HOST",
                "REMOVED_FROM_SPAR",
                "INVITATION_RESTORED",
                "BALLOT_SUBMITTED",
                "FEEDBACK_SUBMITTED",
              ],
            },
            referenceId: { type: "string", format: "uuid", nullable: true },
            referenceType: {
              type: "string",
              nullable: true,
              example: "spar_room",
            },
            payload: { type: "object", nullable: true },
            status: {
              type: "string",
              enum: [
                "pending",
                "sent",
                "read",
                "failed",
                "skipped",
                "cancelled",
              ],
            },
            createdAt: { type: "string", format: "date-time" },
            readAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        Availability: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            startDate: { type: "string", example: "10/03/2026 12:00" },
            endDate: { type: "string", example: "10/03/2026 14:00" },
            format: { type: "string", enum: ["bp", "wsdc"] },
            expectedJudgeLevel: { type: "string", nullable: true },
            expectedDebaterLevel: { type: "string", nullable: true },
            roles: { type: "array", items: { type: "string" } },
          },
        },
        BallotPayload: {
          type: "object",
          required: ["sparId", "teams"],
          description:
            "The data shape depends on the spar's rule (BP or WSDC).\n\n" +
            "**BP (British Parliamentary)**:\n" +
            "- **Teams**: Exactly 4 teams: `OG`, `OO`, `CG`, `CO`.\n" +
            "- **Speakers**: Each team must have exactly 2 speakers.\n" +
            "- **Scores**: 60–80 (in 0.5 increments).\n" +
            "- **Reply Speeches**: Not allowed.\n\n" +
            "**WSDC (World Schools)**:\n" +
            "- **Teams**: Exactly 2 teams: `Proposition`, `Opposition`.\n" +
            "- **Speakers**: Each team must have exactly 3 speakers.\n" +
            "- **Scores**: 60–80 (in 0.5 increments).\n" +
            "- **Reply Speeches**: Allowed (optional). Score must be 30–40 (in 0.5 increments).",
          properties: {
            sparId: { type: "string", format: "uuid" },
            teams: {
              type: "object",
              description:
                "Keys are team names (e.g., OG, Proposition). Values are arrays of speakers.",
              additionalProperties: {
                type: "array",
                items: {
                  type: "object",
                  required: ["userId", "score"],
                  properties: {
                    userId: {
                      type: "string",
                      format: "uuid",
                      description: "Must match an accepted debater in the spar",
                    },
                    score: {
                      type: "number",
                      example: 75.5,
                      description: "60–80, 0.5 increments",
                    },
                    reason: {
                      type: "string",
                      nullable: true,
                      description: "Optional reasoning for the score",
                    },
                  },
                },
              },
            },
            replySpeeches: {
              type: "object",
              nullable: true,
              description: "WSDC only — optional reply scores per team",
              additionalProperties: {
                type: "object",
                required: ["userId", "score"],
                properties: {
                  userId: { type: "string", format: "uuid" },
                  score: {
                    type: "number",
                    example: 38.0,
                    description: "30–40, 0.5 increments",
                  },
                  reason: { type: "string", nullable: true },
                },
              },
            },
          },
          example: {
            sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            teams: {
              OG: [
                {
                  userId: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                  score: 78,
                  reason: "Excellent matter",
                },
                {
                  userId: "e88b64e0-da04-4c54-a15e-aedfbf880ce4",
                  score: 75.5,
                  reason: "Clear structures",
                },
              ],
              OO: [
                {
                  userId: "3b7b51b7-a8a2-4c28-98e6-1413a9bf0eb4",
                  score: 74.5,
                  reason: "Good engagement",
                },
                {
                  userId: "6ab0d1cf-8a71-4a11-b0e2-63fe57e937d5",
                  score: 72,
                  reason: "Needs more depth",
                },
              ],
              CG: [
                {
                  userId: "c460a88e-bc25-4bf5-b3e1-38cbba58e4fb",
                  score: 77,
                  reason: "Strong extension",
                },
                {
                  userId: "bc5cb160-aa25-4c6e-b159-fb92efcd4ef4",
                  score: 76.5,
                  reason: "Solid summary",
                },
              ],
              CO: [
                {
                  userId: "3487c6ea-80dd-4299-add3-8c54530fcb54",
                  score: 73,
                  reason: "Weak framing",
                },
                {
                  userId: "5a9d8cb8-72b1-41e9-9a25-2b0e6e76cc34",
                  score: 71.5,
                  reason: "Missed the clash",
                },
              ],
            },
          },
        },
        FeedbackPayload: {
          type: "object",
          required: ["sparId", "rating", "isAnonymous"],
          properties: {
            sparId: { type: "string", format: "uuid" },
            rating: {
              type: "number",
              minimum: 1,
              maximum: 10,
              example: 8.5,
              description: "Rating in 0.5 increments (1–10)",
            },
            comment: {
              type: "string",
              maxLength: 300,
              nullable: true,
              description: "Optional comment (max 300 characters)",
            },
            isAnonymous: {
              type: "boolean",
              description:
                "If true, the judge will not see who submitted this feedback",
            },
          },
        },
        BallotResponse: {
          type: "object",
          description: "Full ballot as returned to debaters.",
          properties: {
            sparId: { type: "string", format: "uuid" },
            judgeId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Null if the judge deleted their account",
            },
            resultsJson: {
              type: "object",
              description:
                "Raw submitted ballot data (teams → speakers → scores)",
              properties: {
                teams: {
                  type: "object",
                  additionalProperties: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        userId: { type: "string", format: "uuid" },
                        score: { type: "number", example: 75.5 },
                        reason: { type: "string", nullable: true },
                      },
                    },
                  },
                },
                replySpeeches: {
                  type: "object",
                  nullable: true,
                  description: "WSDC only — reply speech scores per team",
                },
              },
            },
            placementsJson: {
              type: "array",
              description:
                "Computed team rankings sorted by rank (1st = highest score). No ties allowed.",
              items: {
                type: "object",
                properties: {
                  team: { type: "string", example: "OG" },
                  rank: { type: "integer", example: 1 },
                  totalScore: { type: "number", example: 152.0 },
                },
              },
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        FeedbackResponse: {
          type: "object",
          description:
            "Feedback as returned to judges. Anonymous feedbacks omit user identity fields.",
          properties: {
            sparId: { type: "string", format: "uuid" },
            debaterId: {
              type: "string",
              format: "uuid",
              nullable: true,
              description: "Omitted if isAnonymous = true",
            },
            rating: { type: "number", example: 8.5 },
            comment: { type: "string", nullable: true },
            isAnonymous: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            username: {
              type: "string",
              nullable: true,
              description: "Only present when isAnonymous = false",
            },
            avatarURL: {
              type: "string",
              nullable: true,
              description: "Only present when isAnonymous = false",
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    paths: {
      // ── Auth ──
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["fullName", "username", "password", "email"],
                  properties: {
                    fullName: { type: "string", example: "John Doe" },
                    username: { type: "string", example: "johndoe" },
                    password: { type: "string", example: "password123" },
                    email: { type: "string", example: "john@example.com" },
                    institution: {
                      type: "string",
                      example: "University of Debate",
                      nullable: true,
                    },
                    avatarURL: { type: "string", example: "1" },
                    tournamentEntries: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["name", "year", "scale", "rule", "role"],
                        properties: {
                          name: { type: "string", example: "WUDC" },
                          year: { type: "string", example: "2025" },
                          scale: { type: "string", example: "100" },
                          rule: {
                            type: "string",
                            enum: ["bp", "wsdc"],
                            example: "bp",
                          },
                          role: {
                            type: "string",
                            enum: [
                              "debater",
                              "independentAdjudicator",
                              "subsidizedAdjudicator",
                              "invitedAdjudicator",
                            ],
                            example: "debater",
                          },
                          debaterDetails: {
                            type: "object",
                            description: "Required if role is debater",
                            properties: {
                              breakingRank: {
                                type: "string",
                                example: "5",
                                nullable: true,
                              },
                              achievement: {
                                type: "string",
                                enum: [
                                  "participant",
                                  "octoFinalist",
                                  "quarterFinalist",
                                  "semiFinalist",
                                  "finalist",
                                  "champion",
                                  "runnerUp",
                                ],
                                example: "champion",
                              },
                            },
                          },
                          judgeDetails: {
                            type: "object",
                            description: "Required if role is adjudicator",
                            properties: {
                              rounds: { type: "string", example: "5" },
                              highestRank: {
                                type: "string",
                                enum: ["trainee", "panel", "chair"],
                                example: "chair",
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                examples: {
                  debater: {
                    summary: "Register as debater",
                    value: {
                      fullName: "John Doe",
                      username: "johndoe",
                      password: "password123",
                      email: "john@example.com",
                      institution: "University of Debate",
                      avatarURL: "1",
                      tournamentEntries: [
                        {
                          name: "WUDC",
                          year: "2025",
                          scale: "100",
                          rule: "bp",
                          role: "debater",
                          debaterDetails: {
                            breakingRank: "5",
                            achievement: "champion",
                          },
                        },
                      ],
                    },
                  },
                  adjudicator: {
                    summary: "Register as adjudicator",
                    value: {
                      fullName: "Jane Smith",
                      username: "janesmith",
                      password: "password123",
                      email: "jane@example.com",
                      institution: "University of Debate",
                      avatarURL: "2",
                      tournamentEntries: [
                        {
                          name: "WUDC",
                          year: "2025",
                          scale: "100",
                          rule: "bp",
                          role: "independentAdjudicator",
                          judgeDetails: {
                            rounds: "5",
                            highestRank: "chair",
                          },
                        },
                      ],
                    },
                  },
                  noEntries: {
                    summary: "Register without tournament entries",
                    value: {
                      fullName: "New User",
                      username: "newuser",
                      password: "password123",
                      email: "new@example.com",
                      institution: null,
                      avatarURL: "1",
                      tournamentEntries: [],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "User registered successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Success" },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login with email and password",
          description:
            "Returns a session cookie on success. Use the same credentials from registration.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" },
                  },
                },
                example: {
                  email: "john@example.com",
                  password: "password123",
                },
              },
            },
          },
          responses: {
            "200": { description: "Login successful (sets session cookie)" },
            "400": {
              description: "Invalid credentials",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Logout (invalidate session)",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Logged out successfully" },
            "401": { description: "Not authenticated" },
          },
        },
      },

      // ── Users ──
      "/users/profile": {
        get: {
          tags: ["Users"],
          summary: "Get own profile",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "User profile",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UserProfile" },
                },
              },
            },
            "404": { description: "Profile not found" },
          },
        },
        put: {
          tags: ["Users"],
          summary: "Update own profile",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    fullName: { type: "string" },
                    username: { type: "string" },
                    email: { type: "string" },
                    institution: { type: "string", nullable: true },
                    password: { type: "string" },
                    currentPassword: {
                      type: "string",
                      description: "Required when changing password or email",
                    },
                    avatarURL: { type: "string" },
                    tournamentEntries: {
                      type: "array",
                      items: { $ref: "#/components/schemas/TournamentEntry" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Profile updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Success" },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/users/search": {
        get: {
          tags: ["Users"],
          summary: "Search users by username or name",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Search term",
            },
          ],
          responses: {
            "200": {
              description: "List of matching users",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        userId: { type: "string" },
                        username: { type: "string" },
                        fullName: { type: "string" },
                        avatarURL: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/users/{username}": {
        get: {
          tags: ["Users"],
          summary: "Get public profile by username",
          parameters: [
            {
              name: "username",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Public profile data" },
            "404": { description: "User not found" },
          },
        },
      },
      "/users/calendar": {
        get: {
          tags: ["Calendar"],
          summary: "Get user's availability calendar",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Calendar data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      calendar: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Availability" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Calendar"],
          summary: "Add availability slot",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["startDate", "endDate", "format", "roles"],
                  properties: {
                    startDate: { type: "string", example: "10/03/2026 12:00" },
                    endDate: { type: "string", example: "10/03/2026 14:00" },
                    format: { type: "string", enum: ["bp", "wsdc"] },
                    roles: {
                      type: "array",
                      items: { type: "string", enum: ["debater", "judge"] },
                    },
                    expectedJudgeLevel: {
                      type: "string",
                      enum: ["novice", "intermediate", "advanced", "expert"],
                      nullable: true,
                    },
                    expectedDebaterLevel: {
                      type: "string",
                      enum: ["novice", "open", "pro"],
                      nullable: true,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Availability added",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Success" },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        put: {
          tags: ["Calendar"],
          summary: "Update availability slot",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id"],
                  properties: {
                    id: { type: "string" },
                    startDate: { type: "string" },
                    endDate: { type: "string" },
                    format: { type: "string", enum: ["bp", "wsdc"] },
                    roles: { type: "array", items: { type: "string" } },
                    expectedJudgeLevel: { type: "string", nullable: true },
                    expectedDebaterLevel: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Availability updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Success" },
                },
              },
            },
            "400": { description: "Validation error" },
          },
        },
        delete: {
          tags: ["Calendar"],
          summary: "Delete availability slot",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id"],
                  properties: {
                    id: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Availability deleted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Success" },
                },
              },
            },
            "400": { description: "Validation error" },
          },
        },
      },
      "/users/calendar-link": {
        get: {
          tags: ["Calendar"],
          summary: "Get or create calendar subscription links",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Calendar links for Apple, Google, Outlook",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      links: {
                        type: "object",
                        properties: {
                          apple: { type: "string" },
                          google: { type: "string" },
                          outlook: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Spars ──
      "/spars/": {
        post: {
          tags: ["Spars"],
          summary: "Create a new spar",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "time", "rule", "expectedDebaterLevel"],
                  properties: {
                    name: { type: "string", example: "John's Spar" },
                    time: {
                      type: "string",
                      example: "10/04/2026 20:00",
                      description: "DD/MM/YYYY HH:MM",
                    },
                    rule: {
                      type: "string",
                      enum: ["bp", "wsdc"],
                      example: "bp",
                    },
                    role: {
                      type: "string",
                      enum: ["debater", "judge"],
                      example: "debater",
                    },
                    expectedDebaterLevel: {
                      type: "string",
                      enum: ["novice", "open", "pro"],
                      example: "open",
                    },
                    expectedJudgeLevel: {
                      type: "string",
                      enum: ["novice", "intermediate", "advanced", "expert"],
                      nullable: true,
                    },
                    motion: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Spar created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" },
                      sparId: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        get: {
          tags: ["Spars"],
          summary: "List available spars (optional auth)",
          description:
            "Returns spars the user hasn't joined. Auth is optional — if provided, filters out user's own spars.",
          responses: {
            "200": {
              description: "List of spars",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Spar" },
                  },
                },
              },
            },
          },
        },
        put: {
          tags: ["Spars"],
          summary: "Update spar (host only, status=created)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId", "name", "time", "expectedDebaterLevel"],
                  properties: {
                    sparId: { type: "string" },
                    name: { type: "string" },
                    time: {
                      type: "string",
                      example: "10/04/2026 20:00",
                      description: "DD/MM/YYYY HH:MM",
                    },
                    expectedDebaterLevel: {
                      type: "string",
                      enum: ["novice", "open", "pro"],
                    },
                    expectedJudgeLevel: {
                      type: "string",
                      enum: ["novice", "intermediate", "advanced", "expert"],
                      nullable: true,
                    },
                    motion: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Spar updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { message: { type: "string" } },
                  },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        delete: {
          tags: ["Spars"],
          summary: "Cancel spar (host only)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: { sparId: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Spar cancelled" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/me": {
        get: {
          tags: ["Spars"],
          summary: "List user's active spars",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "List of active spars with notifications",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Spar" },
                  },
                },
              },
            },
          },
        },
      },
      "/spars/me/history": {
        get: {
          tags: ["Spars"],
          summary: "List user's completed/cancelled spars",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "List of past spars",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Spar" },
                  },
                },
              },
            },
          },
        },
      },
      "/spars/request": {
        post: {
          tags: ["Spars"],
          summary: "Request to join a spar",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: {
                    sparId: { type: "string" },
                    role: {
                      type: "string",
                      enum: ["debater", "judge", "observer"],
                      example: "debater",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Request sent" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/invite": {
        post: {
          tags: ["Spars"],
          summary: "Invite a user to spar (host only)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId", "userId"],
                  properties: {
                    sparId: { type: "string" },
                    userId: { type: "string" },
                    role: {
                      type: "string",
                      enum: ["debater", "judge"],
                      example: "debater",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "User invited" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/matching": {
        post: {
          tags: ["Spars"],
          summary: "Start matching (host only)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: { sparId: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Status changed to matching" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/cancel-matching": {
        post: {
          tags: ["Spars"],
          summary: "Cancel matching (host only)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: { sparId: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Status reverted to created" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/accept": {
        post: {
          tags: ["Spars"],
          summary: "Accept a join request or invitation",
          description:
            "If targetUserId is provided: host accepts a pending request. If omitted: invited user accepts their own invitation.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: {
                    sparId: { type: "string" },
                    targetUserId: {
                      type: "string",
                      description: "Required for host accepting a request",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Accepted" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/decline": {
        post: {
          tags: ["Spars"],
          summary: "Decline a join request or invitation",
          description:
            "If targetUserId is provided: host declines a request. If omitted: invited user declines their own invitation.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: {
                    sparId: { type: "string" },
                    targetUserId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Declined" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/leave": {
        post: {
          tags: ["Spars"],
          summary: "Leave a spar",
          description:
            "If the leaving user is the host, host role is transferred to a judge first, then any other member.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId"],
                  properties: { sparId: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Left spar" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/spars/kick": {
        post: {
          tags: ["Spars"],
          summary: "Kick a member (host only)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sparId", "targetUserId"],
                  properties: {
                    sparId: { type: "string" },
                    targetUserId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Member kicked" },
            "400": {
              description: "Error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/evaluations/ballot": {
        post: {
          tags: ["Spars/Evaluation"],
          summary: "Submit spar ballot (Judge only)",
          description:
            "Submit a judge ballot for a completed spar. Only the accepted judge of the spar may call this endpoint.\n\n" +
            "### Rules:\n" +
            "- **Timing**: Evaluation becomes available **30 minutes** after the spar start time.\n" +
            "- **Judge**: Only the accepted judge can submit.\n" +
            "- **Window**: The **48-hour evaluation window** starts from the 30-minute mark mentioned above (total 48.5h from start).\n" +
            "- **Immutability**: Submissions are write-once and final. You cannot update a ballot after it is submitted.\n" +
            "- **Format**: Format (BP or WSDC) is automatically derived from the spar. The payload must match the expected structure for that rule.\n" +
            "- **Validation**: All `userIds` in the ballot must exactly match the accepted debater members in the spar.\n" +
            "- **No Ties**: Ties are not allowed in the final computed rankings.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BallotPayload" },
                examples: {
                  bp: {
                    summary: "BP Ballot Format",
                    value: {
                      sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                      teams: {
                        OG: [
                          {
                            userId: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                            score: 78,
                            reason: "Excellent matter, very persuasive arguments on the economic impacts.",
                          },
                          {
                            userId: "e88b64e0-da04-4c54-a15e-aedfbf880ce4",
                            score: 75.5,
                            reason: "Clear structures, but missed some opportunities for rebuttal.",
                          },
                        ],
                        OO: [
                          {
                            userId: "3b7b51b7-a8a2-4c28-98e6-1413a9bf0eb4",
                            score: 74.5,
                            reason: "Good engagement with the opening teams, but analysis was slightly superficial.",
                          },
                          {
                            userId: "6ab0d1cf-8a71-4a11-b0e2-63fe57e937d5",
                            score: 72,
                            reason: "Needs more depth in the mechanisms of the arguments.",
                          },
                        ],
                        CG: [
                          {
                            userId: "c460a88e-bc25-4bf5-b3e1-38cbba58e4fb",
                            score: 77,
                            reason: "Strong extension that effectively shifted the debate.",
                          },
                          {
                            userId: "bc5cb160-aa25-4c6e-b159-fb92efcd4ef4",
                            score: 76.5,
                            reason: "Solid summary, correctly identified the key clashes.",
                          },
                        ],
                        CO: [
                          {
                            userId: "3487c6ea-80dd-4299-add3-8c54530fcb54",
                            score: 73,
                            reason: "Weak framing, struggled to differentiate from Opening Opposition.",
                          },
                          {
                            userId: "5a9d8cb8-72b1-41e9-9a25-2b0e6e76cc34",
                            score: 71.5,
                            reason: "Missed the core clash of the debate, focus was misplaced.",
                          },
                        ],
                      },
                    },
                  },
                  wsdc: {
                    summary: "WSDC Ballot Format",
                    value: {
                      sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                      teams: {
                        Proposition: [
                          { userId: "d290f1ee-6c54-4b01-90e6-d701748f0851", score: 72 },
                          { userId: "e88b64e0-da04-4c54-a15e-aedfbf880ce4", score: 73 },
                          { userId: "3b7b51b7-a8a2-4c28-98e6-1413a9bf0eb4", score: 71.5 },
                        ],
                        Opposition: [
                          { userId: "6ab0d1cf-8a71-4a11-b0e2-63fe57e937d5", score: 75 },
                          { userId: "c460a88e-bc25-4bf5-b3e1-38cbba58e4fb", score: 74 },
                          { userId: "bc5cb160-aa25-4c6e-b159-fb92efcd4ef4", score: 72.5 },
                        ],
                      },
                      replySpeeches: {
                        Proposition: { userId: "d290f1ee-6c54-4b01-90e6-d701748f0851", score: 36.5 },
                        Opposition: { userId: "6ab0d1cf-8a71-4a11-b0e2-63fe57e937d5", score: 38 },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Ballot submitted successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: {
                        type: "string",
                        example: "Ballot submitted successfully",
                      },
                    },
                  },
                  example: {
                    message: "Ballot submitted successfully",
                  },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Error" },
                      {
                        type: "object",
                        properties: {
                          error: {
                             type: "object",
                             properties: {
                               message: {
                                 type: "string",
                                 enum: [
                                   "sparId is required",
                                   "Spar not found",
                                   "Spar is cancelled, evaluation is not available.",
                                   "This spar does not have a judge.",
                                   "Evaluation is only available 30 minutes after the spar start time.",
                                   "BP format requires exactly 4 teams, got X",
                                   "Invalid BP team keys: X. Must be: OG, OO, CG, CO",
                                   "BP team X must have exactly 2 speakers, got X",
                                   "WSDC format requires exactly 2 teams, got X",
                                   "WSDC team X must have exactly 3 speakers, got X",
                                   "Reply speeches are not applicable in BP format",
                                   "Duplicate userId found across teams",
                                   "Score out of bounds for user X. Must be 60–80.",
                                   "Score must be in 0.5 increments for user X",
                                   "Reply score out of bounds for user X. Must be 30–40.",
                                   "Reply score must be in 0.5 increments for user X",
                                   "Tied scores are not allowed. Adjust scores to produce a clear ranking.",
                                   "Ballot speakers do not match spar members count.",
                                   "User X is not an accepted debater in this spar.",
                                   "The 48-hour evaluation window has closed.",
                                   "Ballot already submitted. Submissions are final.",
                                 ],
                               },
                             },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "403": {
              description: "Forbidden",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Error" },
                      {
                        type: "object",
                        properties: {
                          error: {
                             type: "object",
                             properties: {
                               message: {
                                 type: "string",
                                 enum: ["Only the accepted judge can submit a ballot."],
                               },
                             },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/evaluations/feedback": {
        post: {
          tags: ["Spars/Evaluation"],
          summary: "Submit judge feedback (Debater only)",
          description:
            "Submit feedback about the judge for a completed spar.\n\n" +
            "### Rules:\n" +
            "- **Timing**: Feedback becomes available **30 minutes** after the spar start time.\n" +
            "- **Debater**: Only accepted debaters can submit feedback.\n" +
            "- **Window**: The **48-hour evaluation window** starts from the 30-minute mark mentioned above.\n" +
            "- **Immutability**: Submissions are write-once and final.\n" +
            "- **Rating**: 1–10 in 0.5 increments.\n" +
            "- **Comment**: Optional, maximum 300 characters.\n" +
            "- **Anonymity**: If `isAnonymous` is true, the judge will see the feedback but not the debater's identity.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FeedbackPayload" },
                examples: {
                  standard: {
                    summary: "Submit Feedback",
                    value: {
                      sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                      rating: 8.5,
                      comment: "Very clear oral adjudication, helped me understand the clash better.",
                      isAnonymous: false,
                    },
                  },
                  anonymous: {
                    summary: "Submit Anonymous Feedback",
                    value: {
                      sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                      rating: 7.0,
                      comment: "Decent feedback, but missed some points on the LO extension.",
                      isAnonymous: true,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Feedback submitted successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: {
                        type: "string",
                        example: "Feedback submitted successfully",
                      },
                    },
                  },
                  example: {
                    message: "Feedback submitted successfully",
                  },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Error" },
                      {
                        type: "object",
                        properties: {
                          error: {
                             type: "object",
                             properties: {
                               message: {
                                 type: "string",
                                 enum: [
                                   "sparId is required",
                                   "Spar not found",
                                   "Spar is cancelled.",
                                   "This spar does not have a judge.",
                                   "Feedback is only available 30 minutes after the spar start time.",
                                   "Rating must be between 1 and 10 and in 0.5 increments.",
                                   "Comment must be 300 characters or fewer.",
                                   "The 48-hour evaluation window has closed.",
                                   "Feedback already submitted. Submissions are final.",
                                 ],
                               },
                             },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "403": {
              description: "Forbidden",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Error" },
                      {
                        type: "object",
                        properties: {
                          error: {
                             type: "object",
                             properties: {
                               message: {
                                 type: "string",
                                 enum: ["Only accepted debaters can submit feedback."],
                               },
                             },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/evaluations": {
        get: {
          tags: ["Spars/Evaluation"],
          summary: "Fetch evaluation data (Blind Reveal)",
          description:
            "Fetch evaluation data for a spar. The response contents and availability depend on the caller's role, the time elapsed since the spar start, and whether they have fulfilled their own evaluation obligations.\n\n" +
            "### Availability & Timing:\n" +
            "- **Early Access**: Evaluation data becomes available **30 minutes** after the spar start time.\n" +
            "- **Deadline**: The evaluation window lasts for **48 hours** from that 30-minute mark.\n\n" +
            "### How It Works:\n" +
            "- **For Debaters**:\n" +
            "  - You can view the **judge's ballot immediately** as soon as it is submitted, regardless of whether you have submitted feedback yet.\n" +
            "  - If the judge has already submitted, you get `status: 'complete'` and the `ballot` object.\n" +
            "  - If the judge hasn't submitted yet (and the 48h window is still open), you get `status: 'pending'` with a message waiting for the judge.\n" +
            "  - If the window expires and the judge never submitted, you get `status: 'draw'`.\n\n" +
            "- **For Judges (Blind Reveal)**:\n" +
            "  - You must **submit your ballot first** to unlock debater feedbacks.\n" +
            "  - If you haven't submitted the ballot (and the 48h window is open), you'll see `status: 'pending'`.\n" +
            "  - Once you submit the ballot (or the 48h window expires), you get `status: 'complete'` and the `feedbacks` array.\n" +
            "  - **Anonymity**: Feedbacks marked as `isAnonymous: true` will have their `debaterId`, `username`, and `avatarURL` fields omitted for you.\n\n" +
            "- **Observers**: Are not allowed to access evaluation data (403 Forbidden).\n" +
            "- **General**: If the spar was created with `expectingJudge: false`, this endpoint always returns `status: 'disabled'`.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "sparId",
              in: "query",
              required: true,
              schema: { type: "string", format: "uuid" },
              description: "ID of the spar to fetch evaluation data for",
            },
          ],
          responses: {
            "200": {
              description: "Evaluation data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: {
                      status: {
                        type: "string",
                        enum: ["complete", "pending", "draw", "disabled"],
                        description: "Current evaluation state",
                      },
                      message: {
                        type: "string",
                        nullable: true,
                        description: "Instructional message",
                      },
                      ballot: {
                        nullable: true,
                        $ref: "#/components/schemas/BallotResponse",
                      },
                      feedbacks: {
                        type: "array",
                        nullable: true,
                        items: { $ref: "#/components/schemas/FeedbackResponse" },
                      },
                    },
                  },
                  examples: {
                    debaterWaiting: {
                      summary: "Debater waiting for judge submission",
                      value: {
                        status: "pending",
                        message: "Waiting for the judge to submit the ballot.",
                        feedbackSubmitted: false
                      },
                    },
                    debaterCompleteBP: {
                      summary: "Debater view: BP Match Complete",
                      value: {
                        status: "complete",
                        feedbackSubmitted: true,
                        ballot: {
                          sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                          judgeId: "550e8400-e29b-41d4-a716-446655440000",
                          resultsJson: {
                            teams: {
                              OG: [
                                { userId: "d290f1ee-6c54-4b01-90e6-d701748f0851", score: 78, reason: "Excellent matter" },
                                { userId: "e88b64e0-da04-4c54-a15e-aedfbf880ce4", score: 75.5, reason: "Clear structures" },
                              ],
                              OO: [
                                { userId: "3b7b51b7-a8a2-4c28-98e6-1413a9bf0eb4", score: 74.5, reason: "Good engagement" },
                                { userId: "6ab0d1cf-8a71-4a11-b0e2-63fe57e937d5", score: 72, reason: "Needs more depth" },
                              ],
                              CG: [
                                { userId: "c460a88e-bc25-4bf5-b3e1-38cbba58e4fb", score: 77, reason: "Strong extension" },
                                { userId: "bc5cb160-aa25-4c6e-b159-fb92efcd4ef4", score: 76.5, reason: "Solid summary" },
                              ],
                              CO: [
                                { userId: "3487c6ea-80dd-4299-add3-8c54530fcb54", score: 73, reason: "Weak framing" },
                                { userId: "5a9d8cb8-72b1-41e9-9a25-2b0e6e76cc34", score: 71.5, reason: "Missed the clash" },
                              ],
                            }
                          },
                          placementsJson: [
                            { team: "OG", rank: 1, totalScore: 153.5 },
                            { team: "CG", rank: 2, totalScore: 153.5 },
                            { team: "OO", rank: 3, totalScore: 146.5 },
                            { team: "CO", rank: 4, totalScore: 144.5 }
                          ],
                          createdAt: "2026-04-07T12:00:00.000Z",
                        },
                      },
                    },
                    debaterCompleteWSDC: {
                      summary: "Debater view: WSDC Match Complete (with Reply Speeches)",
                      value: {
                        status: "complete",
                        feedbackSubmitted: false,
                        ballot: {
                          sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                          judgeId: "550e8400-e29b-41d4-a716-446655440000",
                          resultsJson: {
                            teams: {
                              Proposition: [
                                { userId: "u1", score: 72, reason: "Solid opening" },
                                { userId: "u2", score: 73, reason: "Excellent clash" },
                                { userId: "u3", score: 71.5, reason: "Good summary" },
                              ],
                              Opposition: [
                                { userId: "u4", score: 75, reason: "Very persuasive" },
                                { userId: "u5", score: 74, reason: "Strong logic" },
                                { userId: "u6", score: 72.5, reason: "Deep analysis" },
                              ],
                            },
                            replySpeeches: {
                              Proposition: { userId: "u1", score: 36.5, reason: "Effective summary of the case" },
                              Opposition: { userId: "u4", score: 38, reason: "Strongest part of the opposition" },
                            },
                          },
                          placementsJson: [
                            { team: "Opposition", rank: 1, totalScore: 259.5 },
                            { team: "Proposition", rank: 2, totalScore: 253.0 }
                          ],
                          createdAt: "2026-04-07T12:00:00.000Z",
                        },
                      },
                    },
                    judgePending: {
                      summary: "Judge view: Ballot not yet submitted",
                      value: {
                        status: "pending",
                        message: "Submit your ballot to unlock debater feedback.",
                      },
                    },
                    judgeComplete: {
                      summary: "Judge view: Feedback unlocked",
                      value: {
                        status: "complete",
                        feedbacks: [
                          {
                            sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                            debaterId: "d290f1ee-6c54-4b01-90e6-d701748f0851",
                            rating: 8.5,
                            comment: "Great judging.",
                            isAnonymous: false,
                            username: "johndoe",
                            avatarURL: "1",
                            createdAt: "2026-04-07T10:00:00.000Z",
                          },
                          {
                            sparId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                            rating: 7.0,
                            comment: "Decent, but missed some key extension points.",
                            isAnonymous: true,
                            createdAt: "2026-04-07T11:00:00.000Z",
                          },
                        ],
                      },
                    },
                    matchDraw: {
                      summary: "Match Result: Draw (48h Expired)",
                      value: {
                        status: "draw",
                        message: "The judge did not submit a ballot. The match is scored as a draw.",
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Validation error — sparId query parameter missing",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "403": {
              description:
                "Forbidden — not an accepted member of this spar, or observer role",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "404": {
              description: "Spar not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      // ── Notifications ──
      "/notifications": {
        get: {
          tags: ["Notifications"],
          summary: "Get paginated in-app notifications",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20 },
              description: "Max results (max 100)",
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
              description: "Offset for pagination",
            },
          ],
          responses: {
            "200": {
              description: "Paginated notifications",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Notification" },
                      },
                      pagination: {
                        type: "object",
                        properties: {
                          limit: { type: "integer" },
                          offset: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/notifications/{id}/read": {
        patch: {
          tags: ["Notifications"],
          summary: "Mark a notification as read",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Notification updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { message: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
      "/notifications/unread-count": {
        get: {
          tags: ["Notifications"],
          summary: "Get unread notification count",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Unread count",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          count: { type: "integer", example: 3 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);

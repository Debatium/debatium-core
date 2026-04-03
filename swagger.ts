import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Debatium API",
      version: "1.0.0",
      description: "Debatium core backend API",
    },
    servers: [
      { url: "http://localhost:4000", description: "Development" },
    ],
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
            role: { type: "string", enum: ["debater", "independentAdjudicator", "subsidizedAdjudicator", "invitedAdjudicator"] },
            debaterDetails: {
              type: "object",
              properties: {
                breakingRank: { type: "string" },
                achievement: { type: "string", enum: ["participant", "octoFinalist", "quarterFinalist", "semiFinalist", "finalist", "champion", "runnerUp"] },
              },
            },
            judgeDetails: {
              type: "object",
              properties: {
                rounds: { type: "string" },
                highestRank: { type: "string", enum: ["trainee", "panel", "chair"] },
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
            judgeLevel: { type: "string", enum: ["novice", "intermediate", "advanced", "expert"] },
            avatarURL: { type: "string" },
            tournamentEntries: {
              type: "array",
              items: { $ref: "#/components/schemas/TournamentEntry" },
            },
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
      },
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "id",
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
                    institution: { type: "string", example: "University of Debate", nullable: true },
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
                          rule: { type: "string", enum: ["bp", "wsdc"], example: "bp" },
                          role: { type: "string", enum: ["debater", "independentAdjudicator", "subsidizedAdjudicator", "invitedAdjudicator"], example: "debater" },
                          debaterDetails: {
                            type: "object",
                            description: "Required if role is debater",
                            properties: {
                              breakingRank: { type: "string", example: "5", nullable: true },
                              achievement: { type: "string", enum: ["participant", "octoFinalist", "quarterFinalist", "semiFinalist", "finalist", "champion", "runnerUp"], example: "champion" },
                            },
                          },
                          judgeDetails: {
                            type: "object",
                            description: "Required if role is adjudicator",
                            properties: {
                              rounds: { type: "string", example: "5" },
                              highestRank: { type: "string", enum: ["trainee", "panel", "chair"], example: "chair" },
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
            "201": { description: "User registered successfully", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
            "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login with email and password",
          description: "Returns a session cookie on success. Use the same credentials from registration.",
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
            "400": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Logout (invalidate session)",
          security: [{ cookieAuth: [] }],
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
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "User profile", content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } } },
            "404": { description: "Profile not found" },
          },
        },
        put: {
          tags: ["Users"],
          summary: "Update own profile",
          security: [{ cookieAuth: [] }],
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
                    currentPassword: { type: "string", description: "Required when changing password or email" },
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
            "200": { description: "Profile updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
            "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/users/search": {
        get: {
          tags: ["Users"],
          summary: "Search users by username or name",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Search term" },
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
            { name: "username", in: "path", required: true, schema: { type: "string" } },
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
          security: [{ cookieAuth: [] }],
          responses: {
            "200": {
              description: "Calendar data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      calendar: { type: "array", items: { $ref: "#/components/schemas/Availability" } },
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
          security: [{ cookieAuth: [] }],
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
                    roles: { type: "array", items: { type: "string", enum: ["debater", "judge"] } },
                    expectedJudgeLevel: { type: "string", enum: ["novice", "intermediate", "advanced", "expert"], nullable: true },
                    expectedDebaterLevel: { type: "string", enum: ["novice", "open", "pro"], nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Availability added", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
            "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
        put: {
          tags: ["Calendar"],
          summary: "Update availability slot",
          security: [{ cookieAuth: [] }],
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
            "200": { description: "Availability updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
            "400": { description: "Validation error" },
          },
        },
        delete: {
          tags: ["Calendar"],
          summary: "Delete availability slot",
          security: [{ cookieAuth: [] }],
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
            "200": { description: "Availability deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
            "400": { description: "Validation error" },
          },
        },
      },
      "/users/calendar-link": {
        get: {
          tags: ["Calendar"],
          summary: "Get or create calendar subscription links",
          security: [{ cookieAuth: [] }],
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
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);

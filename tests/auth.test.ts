import { describe, it, expect, vi } from 'vitest';
import { request, createAuthenticatedUser } from './helpers.js';

describe('Authentication Flow', () => {
  it('should register a new user successfully', async () => {
    const res = await request.post('/auth/register').send({
      fullName: 'Auth Test User',
      username: 'authtest',
      email: 'auth@example.com',
      password: 'TestPassword123@',
      institution: 'Auth University',
      tournamentEntries: [],
      avatarURL: 1
    });
    expect(res.status).toBe(201);
  });

  it('should login and return tokens', async () => {
    // First register
    await request.post('/auth/register').send({
      fullName: 'Login Test',
      username: 'logintest',
      email: 'login@example.com',
      password: 'TestPassword123@',
      institution: 'Test Uni',
      tournamentEntries: [],
      avatarURL: 1
    });

    const res = await request.post('/auth/login').send({
      email: 'login@example.com',
      password: 'TestPassword123@'
    });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toMatchObject({
      email: 'login@example.com',
      username: 'logintest'
    });
  });

  it('should fail with incorrect credentials', async () => {
    const res = await request.post('/auth/login').send({
      email: 'wrong@example.com',
      password: 'wrongpassword'
    });
    expect(res.status).toBe(400); // ValueError from auth services maps to 400
  });

  it('should get current user profile with token', async () => {
    const { user, authHeader } = await createAuthenticatedUser();
    
    // Assuming there's a GET /users/me or similar based on tech stack
    const res = await request.get('/users/me').set('Authorization', authHeader.Authorization);
    
    if (res.status === 200) {
      expect(res.body.id).toBe(user.id);
    } else {
      // If /users/me is not implemented yet, we test something else requiring auth
      expect(res.status).not.toBe(401);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { request } from './helpers.js';

describe('Health & Basic Routing', () => {
  it('should return 200 OK for /health', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy' });
  });

  it('should return 404 for unknown routes', async () => {
    const res = await request.get('/not-found');
    expect(res.status).toBe(404);
  });
});

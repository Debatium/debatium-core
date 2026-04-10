import { describe, it, expect } from 'vitest';
import { request } from '../helpers.js';
import { setupDoneSpar } from './helper.js';

describe('Spar Evaluation - Feedback Validation', () => {
  it('should reject feedback ratings < 1 or > 10 or invalid increments', async () => {
    const { sparId, debater1 } = await setupDoneSpar();

    const res1 = await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 0, comment: 'Bad' });
    expect(res1.status).toBe(400);

    const res2 = await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 11, comment: 'Great' });
    expect(res2.status).toBe(400);

    const res3 = await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 7.2, comment: 'Nice' });
    expect(res3.status).toBe(400);
  });

  it('should reject feedback comments over 300 characters', async () => {
    const { sparId, debater1 } = await setupDoneSpar();
    const longComment = 'a'.repeat(301);

    const res = await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 5, comment: longComment });
    expect(res.status).toBe(400);
  });

  it('should reject duplicate feedback submission', async () => {
    const { sparId, debater1 } = await setupDoneSpar();

    // First submission
    await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 8, comment: 'Good', isAnonymous: false })
      .expect(200);

    // Second submission
    const res = await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 9, comment: 'Changed my mind', isAnonymous: false });
    expect(res.status).toBe(400);
  });
});

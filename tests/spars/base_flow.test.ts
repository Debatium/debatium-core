import { describe, it, expect } from 'vitest';
import { request, createAuthenticatedUser } from '../helpers.js';
import { setupDoneSpar } from './helper.js';

describe('Spar Evaluation - Base Flow', () => {
  it('should prevent observers or non-members from accessing evaluation', async () => {
    const { sparId } = await setupDoneSpar();
    const stranger = await createAuthenticatedUser();
    const res = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', stranger.authHeader.Authorization);
    
    expect(res.status).toBe(403); 
  });

  it('should show "pending" for debaters initially (waiting for judge)', async () => {
    const { sparId, debater1 } = await setupDoneSpar();
    const res = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization);
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.feedbackSubmitted).toBe(false);
  });

  it('should execute full evaluation flow (immediate reveal for debaters)', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    // 1. Debater 1 submits feedback
    await request
      .post('/spars/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 9, comment: 'Nice', isAnonymous: false })
      .expect(200);

    // 2. Debater 1 checks status -> pending (waiting for judge)
    const check1 = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization);
    expect(check1.body.status).toBe('pending');
    expect(check1.body.feedbackSubmitted).toBe(true);

    // 3. Judge submits ballot
    await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({
        sparId,
        teams: {
          Proposition: [
            { userId: host.user.id, score: 70 },
            { userId: debater1.user.id, score: 71 },
            { userId: d3.user.id, score: 72 }
          ],
          Opposition: [
            { userId: debater2.user.id, score: 75 },
            { userId: d4.user.id, score: 76 },
            { userId: d5.user.id, score: 77 }
          ]
        }
      })
      .expect(200);

    // 4. Debater 1 checks status -> complete
    const check2 = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization);
    expect(check2.body.status).toBe('complete');
    expect(check2.body.ballot).toBeDefined();
    expect(check2.body.feedbackSubmitted).toBe(true);

    // 5. Debater 2 checks status -> complete
    const check3 = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', debater2.authHeader.Authorization);
    expect(check3.body.status).toBe('complete');
    expect(check3.body.ballot).toBeDefined();
    expect(check3.body.feedbackSubmitted).toBe(false);

    // 6. Judge checks status -> complete (reveals feedbacks)
    const check4 = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', judge.authHeader.Authorization);
    expect(check4.body.status).toBe('complete');
    expect(check4.body.feedbacks.length).toBeGreaterThan(0);
  });
});

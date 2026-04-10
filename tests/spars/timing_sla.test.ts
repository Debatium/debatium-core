import { describe, it, expect } from 'vitest';
import { request } from '../helpers.js';
import { setupDoneSpar } from './helper.js';
import { getPool } from '../../extensions/db.js';

describe('Spar Evaluation - Timing and SLA', () => {
  it('should prevent evaluation before 30 minutes', async () => {
    const { sparId, judge, debater1 } = await setupDoneSpar();
    const pool = getPool();
    const nearPastTime = new Date(Date.now() - 25 * 60 * 1000); // 25 mins ago
    await pool.query(`UPDATE spars SET time = $1 WHERE id = $2`, [nearPastTime, sparId]);

    const res = await request
      .get(`/evaluations?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization);
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');

    const ballotRes = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({ sparId, teams: { Proposition: [], Opposition: [] } });
    expect(ballotRes.status).toBe(400);
  });

  it('should allow evaluation when status is "debating" but 30 minutes have passed', async () => {
    const { sparId, debater1 } = await setupDoneSpar();
    const pool = getPool();
    await pool.query(`UPDATE spars SET status = 'debating' WHERE id = $1`, [sparId]);

    const res = await request
      .get(`/evaluations?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization);
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('should close evaluation window after 48.5 hours', async () => {
    const { sparId, judge, debater1 } = await setupDoneSpar();
    const pool = getPool();
    // 48.5 hours = 2910 minutes
    const wayPastTime = new Date(Date.now() - 2911 * 60 * 1000); 
    await pool.query(`UPDATE spars SET time = $1 WHERE id = $2`, [wayPastTime, sparId]);

    const res = await request
      .get(`/evaluations?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization);
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draw');

    const ballotRes = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({ sparId, teams: { Proposition: [], Opposition: [] } });
    expect(ballotRes.status).toBe(400);
  });

  it('should prevent late feedback submission (after 48.5 hours)', async () => {
    const { sparId, debater1 } = await setupDoneSpar();
    const pool = getPool();
    // 48.6 hours ago
    const wayPastTime = new Date(Date.now() - 2916 * 60 * 1000); 
    await pool.query(`UPDATE spars SET time = $1 WHERE id = $2`, [wayPastTime, sparId]);

    const res = await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 8, comment: 'Too late', isAnonymous: false });
    
    expect(res.status).toBe(400);
  });

  it("should obscure debater feedback for judge before ballot submission", async () => {
    const { sparId, judge, debater1 } = await setupDoneSpar();
    
    // 1. Debater submits feedback
    await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 9, comment: 'Nice', isAnonymous: false })
      .expect(200);

    // 2. Judge checks status -> pending (no feedbacks)
    const res = await request
      .get(`/evaluations?sparId=${sparId}`)
      .set('Authorization', judge.authHeader.Authorization);
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toContain("Submit your ballot to unlock debater feedback.");
    expect(res.body.feedbacks).toBeUndefined();
  });

  it("should allow judge to see feedback after window expires (Post-Draw Visibility)", async () => {
    const { sparId, judge, debater1 } = await setupDoneSpar();
    const pool = getPool();

    // 1. Debater submits feedback
    await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 9, comment: 'Nice', isAnonymous: false })
      .expect(200);

    // 2. Window expires (49 hours ago)
    const wayPastTime = new Date(Date.now() - 2940 * 60 * 1000); 
    await pool.query(`UPDATE spars SET time = $1 WHERE id = $2`, [wayPastTime, sparId]);

    // 3. Judge checks status -> complete (unlocks feedback even without ballot)
    const res = await request
      .get(`/evaluations?sparId=${sparId}`)
      .set('Authorization', judge.authHeader.Authorization);
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('complete');
    expect(res.body.feedbacks).toBeDefined();
    expect(res.body.feedbacks.length).toBeGreaterThan(0);
  });
});

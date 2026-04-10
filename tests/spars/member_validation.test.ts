import { describe, it, expect } from 'vitest';
import { request, createAuthenticatedUser } from '../helpers.js';
import { setupDoneSpar } from './helper.js';
import { v6 as uuidv6 } from 'uuid';

describe('Spar Evaluation - Member Validation', () => {
  it('should reject ballot with missing debater IDs', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4] = extras; // Missing d5
    
    const payload = {
      sparId,
      teams: {
        Proposition: [
          { userId: host.user.id, score: 70 },
          { userId: debater1.user.id, score: 71 },
          { userId: d3.user.id, score: 72 }
        ],
        Opposition: [
          { userId: debater2.user.id, score: 75 },
          { userId: d4.user.id, score: 76 }
          // Missing d5
        ]
      }
    };

    const res = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should reject ballot with foreign or fake user IDs', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4] = extras;
    const fakeId = uuidv6();

    const payload = {
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
          { userId: fakeId, score: 77 } // Fake ID
        ]
      }
    };

    const res = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should reject assigning a score to an observer', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4] = extras;
    
    // Add an observer
    const observer = await createAuthenticatedUser();
    await request
      .post('/spars/invite')
      .set('Authorization', host.authHeader.Authorization)
      .send({ sparId, userId: observer.user.id, role: 'observer' })
      .expect(200);
    await request
      .post('/spars/accept')
      .set('Authorization', observer.authHeader.Authorization)
      .send({ sparId })
      .expect(200);

    const payload = {
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
          { userId: observer.user.id, score: 77 } // Observer
        ]
      }
    };

    const res = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should reject judge assigning a score to themselves', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4] = extras;

    const payload = {
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
          { userId: judge.user.id, score: 77 } // Judge
        ]
      }
    };

    const res = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should reject duplicate speakers in ballot', async () => {
    const { sparId, host, judge, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    const payload = {
      sparId,
      teams: {
        Proposition: [
          { userId: host.user.id, score: 70 },
          { userId: d3.user.id, score: 71 },
          { userId: host.user.id, score: 72 } // Duplicate host
        ],
        Opposition: [
          { userId: debater2.user.id, score: 75 },
          { userId: d4.user.id, score: 76 },
          { userId: d5.user.id, score: 77 }
        ]
      }
    };

    const res = await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  describe('Role-Based Access Guards', () => {
    it('should forbid debaters from submitting ballots', async () => {
      const { sparId, host, debater1, debater2, extras } = await setupDoneSpar();
      const [d3, d4, d5] = extras;

      const payload = {
        sparId,
        teams: {
          Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }, { userId: d3.user.id, score: 72 }],
          Opposition: [{ userId: debater2.user.id, score: 75 }, { userId: d4.user.id, score: 76 }, { userId: d5.user.id, score: 77 }]
        }
      };

      const res = await request
        .post('/evaluations/ballot')
        .set('Authorization', debater1.authHeader.Authorization)
        .send(payload);
      expect(res.status).toBe(403);
    });

    it('should forbid judges from submitting feedback', async () => {
      const { sparId, judge } = await setupDoneSpar();

      const res = await request
        .post('/evaluations/feedback')
        .set('Authorization', judge.authHeader.Authorization)
        .send({
          sparId,
          rating: 8,
          comment: 'Good match',
          isAnonymous: false
        });
      expect(res.status).toBe(403);
    });

    it('should forbid observers from accessing evaluation data', async () => {
      const { sparId, host } = await setupDoneSpar();
      const observer = await createAuthenticatedUser();

      // Add observer
      await request
        .post('/spars/invite')
        .set('Authorization', host.authHeader.Authorization)
        .send({ sparId, userId: observer.user.id, role: 'observer' })
        .expect(200);
      await request
        .post('/spars/accept')
        .set('Authorization', observer.authHeader.Authorization)
        .send({ sparId })
        .expect(200);

      const res = await request
        .get(`/evaluations?sparId=${sparId}`)
        .set('Authorization', observer.authHeader.Authorization);
      expect(res.status).toBe(403);
    });

    it('should forbid observers from submitting ballots or feedback', async () => {
      const { sparId, host, debater1, debater2, extras } = await setupDoneSpar();
      const [d3, d4, d5] = extras;
      const observer = await createAuthenticatedUser();

      // Add observer
      await request
        .post('/spars/invite')
        .set('Authorization', host.authHeader.Authorization)
        .send({ sparId, userId: observer.user.id, role: 'observer' })
        .expect(200);
      await request
        .post('/spars/accept')
        .set('Authorization', observer.authHeader.Authorization)
        .send({ sparId })
        .expect(200);

      // Attempt Ballot
      const ballotRes = await request
        .post('/evaluations/ballot')
        .set('Authorization', observer.authHeader.Authorization)
        .send({
          sparId,
          teams: {
            Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }, { userId: d3.user.id, score: 72 }],
            Opposition: [{ userId: debater2.user.id, score: 75 }, { userId: d4.user.id, score: 76 }, { userId: d5.user.id, score: 77 }]
          }
        });
      expect(ballotRes.status).toBe(403);

      // Attempt Feedback
      const feedbackRes = await request
        .post('/evaluations/feedback')
        .set('Authorization', observer.authHeader.Authorization)
        .send({ sparId, rating: 5, comment: 'I am just watching', isAnonymous: true });
      expect(feedbackRes.status).toBe(403);
    });
  });
});

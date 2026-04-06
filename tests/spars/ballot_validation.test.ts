import { describe, it, expect } from 'vitest';
import { request } from '../helpers.js';
import { setupDoneSpar } from './helper.js';
import { v6 as uuidv6 } from 'uuid';

describe('Spar Evaluation - Ballot Validation', () => {
  it('should prevent tied scores in ballot submission', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;
    
    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({
        sparId,
        teams: {
          Proposition: [
            { userId: host.user.id, score: 75 },
            { userId: debater1.user.id, score: 75 },
            { userId: d3.user.id, score: 75 }
          ],
          Opposition: [
            { userId: debater2.user.id, score: 75 },
            { userId: d4.user.id, score: 75 },
            { userId: d5.user.id, score: 75 }
          ]
        }
      });
    expect(res.status).toBe(400);
  });

  it('should reject speaker scores < 60 or > 80', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    const payload = {
      sparId,
      teams: {
        Proposition: [
          { userId: host.user.id, score: 59 },
          { userId: debater1.user.id, score: 70 },
          { userId: d3.user.id, score: 81 }
        ],
        Opposition: [
          { userId: debater2.user.id, score: 75 },
          { userId: d4.user.id, score: 76 },
          { userId: d5.user.id, score: 77 }
        ]
      }
    };

    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should reject reply speech scores < 30 or > 40', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    const payload = {
      sparId,
      teams: {
        Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 70 }, { userId: d3.user.id, score: 70 }],
        Opposition: [{ userId: debater2.user.id, score: 71 }, { userId: d4.user.id, score: 71 }, { userId: d5.user.id, score: 71 }]
      },
      replySpeeches: {
        Proposition: { userId: host.user.id, score: 29 },
        Opposition: { userId: debater2.user.id, score: 41 }
      }
    };

    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should reject score increments other than 0.5', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    const payload = {
      sparId,
      teams: {
        Proposition: [{ userId: host.user.id, score: 70.2 }, { userId: debater1.user.id, score: 70 }, { userId: d3.user.id, score: 70 }],
        Opposition: [{ userId: debater2.user.id, score: 71 }, { userId: d4.user.id, score: 71 }, { userId: d5.user.id, score: 71.9 }]
      }
    };

    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('should successfully submit WSDC ballot without replySpeeches', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({
        sparId,
        teams: {
          Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }, { userId: d3.user.id, score: 72 }],
          Opposition: [{ userId: debater2.user.id, score: 75 }, { userId: d4.user.id, score: 76 }, { userId: d5.user.id, score: 77 }]
        }
      })
      .expect(200);

    const res = await request
      .get(`/spars/evaluation?sparId=${sparId}`)
      .set('Authorization', debater1.authHeader.Authorization)
      .expect(200);
    
    expect(res.body.status).toBe('complete');
    expect(res.body.ballot.resultsJson.replySpeeches).toBeNull();
    expect(res.body.ballot.placementsJson[0].team).toBe('Opposition');
  });

  it('should reject BP payload for a WSDC spar and vice-versa', async () => {
    const { sparId, host, judge, debater1, debater2 } = await setupDoneSpar();
    const bpPayload = {
      sparId,
      teams: {
        OG: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }],
        OO: [{ userId: debater2.user.id, score: 75 }, { userId: uuidv6(), score: 76 }],
        CG: [{ userId: uuidv6(), score: 79 }, { userId: uuidv6(), score: 80 }],
        CO: [{ userId: uuidv6(), score: 71 }, { userId: uuidv6(), score: 72 }]
      }
    };

    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(bpPayload);
    expect(res.status).toBe(400); 
  });

  it('should reject incorrect number of speakers per team', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    // WSDC requires 3 speakers per team
    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({
        sparId,
        teams: {
          Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }], // Only 2
          Opposition: [{ userId: debater2.user.id, score: 75 }, { userId: d4.user.id, score: 76 }, { userId: d5.user.id, score: 77 }, { userId: d3.user.id, score: 78 }] // 4
        }
      });
    expect(res.status).toBe(400);
  });

  it('should reject duplicate ballot submission', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    const payload = {
      sparId,
      teams: {
        Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }, { userId: d3.user.id, score: 72 }],
        Opposition: [{ userId: debater2.user.id, score: 75 }, { userId: d4.user.id, score: 76 }, { userId: d5.user.id, score: 77 }]
      }
    };

    // First submission
    await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload)
      .expect(200);

    // Second submission
    const res = await request
      .post('/spars/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send(payload);
    expect(res.status).toBe(400);
  });
});

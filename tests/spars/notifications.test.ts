import { describe, it, expect } from 'vitest';
import { request } from '../helpers.js';
import { setupDoneSpar } from './helper.js';

describe('Spar Evaluation - Notifications', () => {
  it('should trigger BALLOT_SUBMITTED notification for all debaters', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    // 1. Judge submits ballot
    await request
      .post('/evaluations/ballot')
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

    // 2. Verify notifications for each debater via API
    const debaters = [host, debater1, debater2, d3, d4, d5];
    
    for (const debater of debaters) {
      const res = await request
        .get('/notifications?limit=50')
        .set('Authorization', debater.authHeader.Authorization)
        .expect(200);
      
      const notifications = res.body.data;
      const ballotNotif = notifications.find((n: any) => 
        n.eventType === 'BALLOT_SUBMITTED' && n.referenceId === sparId
      );
      
      expect(ballotNotif).toBeDefined();
      expect(ballotNotif.referenceType).toBe('spar_room');
    }
  });

  it("should NOT trigger FEEDBACK_SUBMITTED notification if judge hasn't submitted ballot yet", async () => {
    const { sparId, judge, debater1 } = await setupDoneSpar();

    // 1. Debater submits feedback
    await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 9, comment: 'Nice', isAnonymous: false })
      .expect(200);

    // 2. Verify no FEEDBACK_SUBMITTED notification for judge via API
    const res = await request
      .get('/notifications?limit=50')
      .set('Authorization', judge.authHeader.Authorization)
      .expect(200);
    
    const feedbackNotif = res.body.data.find((n: any) => 
      n.eventType === 'FEEDBACK_SUBMITTED' && n.referenceId === sparId
    );
    expect(feedbackNotif).toBeUndefined();
  });

  it('should trigger FEEDBACK_SUBMITTED notification for judge if ballot already exists', async () => {
    const { sparId, host, judge, debater1, debater2, extras } = await setupDoneSpar();
    const [d3, d4, d5] = extras;

    // 1. Judge submits ballot first
    await request
      .post('/evaluations/ballot')
      .set('Authorization', judge.authHeader.Authorization)
      .send({
        sparId,
        teams: {
          Proposition: [{ userId: host.user.id, score: 70 }, { userId: debater1.user.id, score: 71 }, { userId: d3.user.id, score: 72 }],
          Opposition: [{ userId: debater2.user.id, score: 75 }, { userId: d4.user.id, score: 76 }, { userId: d5.user.id, score: 77 }]
        }
      })
      .expect(200);

    // 2. Debater submits feedback
    await request
      .post('/evaluations/feedback')
      .set('Authorization', debater1.authHeader.Authorization)
      .send({ sparId, rating: 9, comment: 'Great job', isAnonymous: false })
      .expect(200);

    // 3. Verify notification for judge via API
    const res = await request
      .get('/notifications?limit=50')
      .set('Authorization', judge.authHeader.Authorization)
      .expect(200);
    
    const feedbackNotif = res.body.data.find((n: any) => 
      n.eventType === 'FEEDBACK_SUBMITTED' && n.referenceId === sparId
    );
    
    expect(feedbackNotif).toBeDefined();
    expect(feedbackNotif.referenceType).toBe('spar_room');
  });
});

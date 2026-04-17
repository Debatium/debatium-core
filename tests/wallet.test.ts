import { describe, it, expect } from 'vitest';
import { request, createAuthenticatedUser } from './helpers.js';
import { getPool } from '../extensions/db.js';

async function seedBalance(userId: string, amount: number) {
  const pool = getPool();
  await pool.query('UPDATE users SET available_balance = $1 WHERE id = $2', [amount, userId]);
}

async function getBalance(userId: string) {
  const pool = getPool();
  const res = await pool.query('SELECT available_balance, frozen_balance FROM users WHERE id = $1', [userId]);
  return {
    available: parseFloat(res.rows[0].available_balance),
    frozen: parseFloat(res.rows[0].frozen_balance)
  };
}

function formatSparDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ──────────────────────────────────────────────────────────────
// WSDC Spar Wallet Lifecycle
// ──────────────────────────────────────────────────────────────
describe('WSDC Spar Wallet Lifecycle', () => {
  it('should freeze, fulfill, and reward coins correctly in a 6+1 WSDC match', async () => {
    // 1. Setup Participants
    const host = await createAuthenticatedUser({ username: 'host_debater' });
    const debaters = [host];
    for (let i = 2; i <= 6; i++) {
      debaters.push(await createAuthenticatedUser({ username: `debater_${i}` }));
    }
    const judge = await createAuthenticatedUser({ username: 'judge_user' });

    // 2. Seed Balances (50 each)
    for (const d of debaters) await seedBalance(d.user.id, 50);
    await seedBalance(judge.user.id, 50);

    // 3. Create WSDC Spar
    const futureTime = new Date(Date.now() + 7200 * 1000); // 2 hours from now
    const timeStr = formatSparDate(futureTime);
    
    const createRes = await request
      .post('/spars')
      .set(host.authHeader)
      .send({
        name: 'WSDC Wallet Test',
        time: timeStr,
        rule: 'wsdc',
        expectedDebaterLevel: 'open',
        expectingJudge: true,
        expectedJudgeLevel: 'novice',
        role: 'debater'
      });

    expect(createRes.status).toBe(201);
    const sparId = createRes.body.sparId;

    expect((await getBalance(host.user.id)).frozen).toBe(10);

    // 4. Joining Phase
    for (let i = 1; i < debaters.length; i++) {
        const d = debaters[i];
        await request.post('/spars/request').set(d.authHeader).send({ sparId, role: 'debater' });
        await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: d.user.id });
        expect((await getBalance(d.user.id)).frozen).toBe(10);
    }

    // Judge joins
    await request.post('/spars/request').set(judge.authHeader).send({ sparId, role: 'judge' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: judge.user.id });

    // 5. Force Transitions
    const pool = getPool();
    const leadTime = new Date(Date.now() + 600 * 1000);
    await pool.query('UPDATE spars SET time = $1 WHERE id = $2', [leadTime, sparId]);
    await pool.query('UPDATE spar_members SET status = $1 WHERE spar_id = $2 AND user_id = $3', ['accepted', sparId, judge.user.id]);

    await request.post('/spars/start-debate').set(host.authHeader).send({ sparId });
    await request.post('/spars/start-evaluation').set(host.authHeader).send({ sparId });

    // 6. Submit Ballot
    const ballotRes = await request
      .post('/evaluations/ballot')
      .set(judge.authHeader)
      .send({
        sparId,
        teams: {
          Proposition: [
            { userId: debaters[0].user.id, score: 75 },
            { userId: debaters[1].user.id, score: 74 },
            { userId: debaters[2].user.id, score: 73 }
          ],
          Opposition: [
            { userId: debaters[3].user.id, score: 72 },
            { userId: debaters[4].user.id, score: 71 },
            { userId: debaters[5].user.id, score: 70 }
          ]
        }
      });

    expect(ballotRes.status).toBe(200);

    // 7. Final Verification
    for (const d of debaters) {
      const b = await getBalance(d.user.id);
      expect(b.available).toBe(40);
      expect(b.frozen).toBe(0);
    }

    const judgeBalanceFinal = await getBalance(judge.user.id);
    expect(judgeBalanceFinal.available).toBe(98);
  });

  it('should refund coins correctly when a spar is cancelled', async () => {
    const host = await createAuthenticatedUser({ username: 'cancel_host' });
    const guest = await createAuthenticatedUser({ username: 'cancel_guest' });

    await seedBalance(host.user.id, 50);
    await seedBalance(guest.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Cancel Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    await request.post('/spars/request').set(guest.authHeader).send({ sparId, role: 'debater' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: guest.user.id });

    expect((await getBalance(host.user.id)).frozen).toBe(10);
    expect((await getBalance(guest.user.id)).frozen).toBe(10);

    const cancelRes = await request.delete('/spars').set(host.authHeader).send({ sparId });
    expect(cancelRes.status).toBe(200);

    expect((await getBalance(host.user.id)).available).toBe(50);
    expect((await getBalance(guest.user.id)).available).toBe(50);
  });
});

// ──────────────────────────────────────────────────────────────
// BP Spar Wallet Lifecycle
// ──────────────────────────────────────────────────────────────
describe('BP Spar Wallet Lifecycle', () => {
  it('should freeze, fulfill, and reward coins correctly in an 8+1 BP match', async () => {
    // 1. Setup 8 debaters + 1 judge
    const host = await createAuthenticatedUser({ username: 'bp_host' });
    const debaters = [host];
    for (let i = 2; i <= 8; i++) {
      debaters.push(await createAuthenticatedUser({ username: `bp_debater_${i}` }));
    }
    const judge = await createAuthenticatedUser({ username: 'bp_judge' });

    // 2. Seed Balances (50 each)
    for (const d of debaters) await seedBalance(d.user.id, 50);
    await seedBalance(judge.user.id, 50);

    // 3. Create BP Spar
    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'BP Wallet Test',
      time: timeStr,
      rule: 'bp',
      expectedDebaterLevel: 'open',
      expectingJudge: true,
      expectedJudgeLevel: 'novice',
      role: 'debater'
    });

    expect(createRes.status).toBe(201);
    const sparId = createRes.body.sparId;

    // Host freeze verified
    expect((await getBalance(host.user.id)).frozen).toBe(10);

    // 4. Joining Phase — remaining 7 debaters
    for (let i = 1; i < debaters.length; i++) {
      const d = debaters[i];
      await request.post('/spars/request').set(d.authHeader).send({ sparId, role: 'debater' });
      await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: d.user.id });
      expect((await getBalance(d.user.id)).frozen).toBe(10);
    }

    // Judge joins
    await request.post('/spars/request').set(judge.authHeader).send({ sparId, role: 'judge' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: judge.user.id });

    // 5. Force Transitions
    const pool = getPool();
    const leadTime = new Date(Date.now() + 600 * 1000);
    await pool.query('UPDATE spars SET time = $1 WHERE id = $2', [leadTime, sparId]);
    await pool.query('UPDATE spar_members SET status = $1 WHERE spar_id = $2 AND user_id = $3', ['accepted', sparId, judge.user.id]);

    await request.post('/spars/start-debate').set(host.authHeader).send({ sparId });
    await request.post('/spars/start-evaluation').set(host.authHeader).send({ sparId });

    // 6. Submit BP Ballot (4 teams × 2 speakers, no reply speeches)
    const ballotRes = await request
      .post('/evaluations/ballot')
      .set(judge.authHeader)
      .send({
        sparId,
        teams: {
          OG: [
            { userId: debaters[0].user.id, score: 78 },
            { userId: debaters[1].user.id, score: 76 }
          ],
          OO: [
            { userId: debaters[2].user.id, score: 75 },
            { userId: debaters[3].user.id, score: 74 }
          ],
          CG: [
            { userId: debaters[4].user.id, score: 73 },
            { userId: debaters[5].user.id, score: 71 }
          ],
          CO: [
            { userId: debaters[6].user.id, score: 70 },
            { userId: debaters[7].user.id, score: 68 }
          ]
        }
      });

    expect(ballotRes.status).toBe(200);

    // 7. Final Verification
    // Each debater: 50 - 10(fee) = 40 available, 0 frozen
    for (const d of debaters) {
      const b = await getBalance(d.user.id);
      expect(b.available).toBe(40);
      expect(b.frozen).toBe(0);
    }

    // Judge: 50 + 8 debaters × floor(10 × 0.85) = 50 + 8×8 = 114
    const judgeBalance = await getBalance(judge.user.id);
    expect(judgeBalance.available).toBe(114);
  });
});

// ──────────────────────────────────────────────────────────────
// Wallet Edge Cases
// ──────────────────────────────────────────────────────────────
describe('Wallet Edge Cases', () => {
  it('should reject spar creation when debater has insufficient balance', async () => {
    const user = await createAuthenticatedUser({ username: 'broke_host' });
    // Balance defaults to 0 — do not seed

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const res = await request.post('/spars').set(user.authHeader).send({
      name: 'Broke Create Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should reject join request when debater has insufficient balance', async () => {
    // Host has enough, joiner does not
    const host = await createAuthenticatedUser({ username: 'rich_host' });
    const joiner = await createAuthenticatedUser({ username: 'poor_joiner' });

    await seedBalance(host.user.id, 50);
    await seedBalance(joiner.user.id, 5); // Less than SPAR_FEE (10)

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Insufficient Join Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });
    expect(createRes.status).toBe(201);
    const sparId = createRes.body.sparId;

    const joinRes = await request.post('/spars/request').set(joiner.authHeader).send({ sparId, role: 'debater' });
    expect(joinRes.status).toBeGreaterThanOrEqual(400);
  });

  it('should NOT freeze coins when a judge joins a spar', async () => {
    const host = await createAuthenticatedUser({ username: 'judge_freeze_host' });
    const judgeUser = await createAuthenticatedUser({ username: 'judge_no_freeze' });

    await seedBalance(host.user.id, 50);
    await seedBalance(judgeUser.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Judge No Freeze Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: true,
      expectedJudgeLevel: 'novice',
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    // Judge requests to join
    await request.post('/spars/request').set(judgeUser.authHeader).send({ sparId, role: 'judge' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: judgeUser.user.id });

    // Judge balance should be untouched
    const judgeBalance = await getBalance(judgeUser.user.id);
    expect(judgeBalance.available).toBe(50);
    expect(judgeBalance.frozen).toBe(0);
  });

  it('should refund coins when a debater leaves a spar', async () => {
    const host = await createAuthenticatedUser({ username: 'leave_host' });
    const leaver = await createAuthenticatedUser({ username: 'leave_debater' });

    await seedBalance(host.user.id, 50);
    await seedBalance(leaver.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Leave Refund Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    // Join and get accepted
    await request.post('/spars/request').set(leaver.authHeader).send({ sparId, role: 'debater' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: leaver.user.id });

    // Verify frozen
    expect((await getBalance(leaver.user.id)).frozen).toBe(10);
    expect((await getBalance(leaver.user.id)).available).toBe(40);

    // Leave
    const leaveRes = await request.post('/spars/leave').set(leaver.authHeader).send({ sparId });
    expect(leaveRes.status).toBe(200);

    // Verify full refund
    const balance = await getBalance(leaver.user.id);
    expect(balance.available).toBe(50);
    expect(balance.frozen).toBe(0);
  });

  it('should refund coins when a debater is kicked from a spar', async () => {
    const host = await createAuthenticatedUser({ username: 'kick_host' });
    const kicked = await createAuthenticatedUser({ username: 'kicked_debater' });

    await seedBalance(host.user.id, 50);
    await seedBalance(kicked.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Kick Refund Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    // Join and get accepted
    await request.post('/spars/request').set(kicked.authHeader).send({ sparId, role: 'debater' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: kicked.user.id });

    expect((await getBalance(kicked.user.id)).frozen).toBe(10);

    // Host kicks the debater
    const kickRes = await request.post('/spars/kick').set(host.authHeader).send({ sparId, targetUserId: kicked.user.id });
    expect(kickRes.status).toBe(200);

    // Verify full refund
    const balance = await getBalance(kicked.user.id);
    expect(balance.available).toBe(50);
    expect(balance.frozen).toBe(0);
  });

  it('should refund coins when host declines a pending debater request', async () => {
    const host = await createAuthenticatedUser({ username: 'decline_host' });
    const requester = await createAuthenticatedUser({ username: 'decline_requester' });

    await seedBalance(host.user.id, 50);
    await seedBalance(requester.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Decline Refund Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    // Requester sends join request (coins frozen on request)
    await request.post('/spars/request').set(requester.authHeader).send({ sparId, role: 'debater' });
    expect((await getBalance(requester.user.id)).frozen).toBe(10);

    // Host declines
    const declineRes = await request.post('/spars/decline').set(host.authHeader).send({ sparId, targetUserId: requester.user.id });
    expect(declineRes.status).toBe(200);

    // Verify full refund
    const balance = await getBalance(requester.user.id);
    expect(balance.available).toBe(50);
    expect(balance.frozen).toBe(0);
  });

  it('should NOT freeze coins when creating a spar as a judge', async () => {
    const judgeHost = await createAuthenticatedUser({ username: 'judge_host' });
    await seedBalance(judgeHost.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(judgeHost.authHeader).send({
      name: 'Judge Host Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: true,
      expectedJudgeLevel: 'novice',
      role: 'judge'
    });

    expect(createRes.status).toBe(201);

    // Balance should remain untouched
    const balance = await getBalance(judgeHost.user.id);
    expect(balance.available).toBe(50);
    expect(balance.frozen).toBe(0);
  });

  it('should reject a second ballot submission (double ballot)', async () => {
    // Setup a minimal WSDC spar in evaluating state
    const host = await createAuthenticatedUser({ username: 'dbl_host' });
    const debaters = [host];
    for (let i = 2; i <= 6; i++) {
      debaters.push(await createAuthenticatedUser({ username: `dbl_d${i}` }));
    }
    const judge = await createAuthenticatedUser({ username: 'dbl_judge' });

    for (const d of debaters) await seedBalance(d.user.id, 50);
    await seedBalance(judge.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Double Ballot Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: true,
      expectedJudgeLevel: 'novice',
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    for (let i = 1; i < debaters.length; i++) {
      await request.post('/spars/request').set(debaters[i].authHeader).send({ sparId, role: 'debater' });
      await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: debaters[i].user.id });
    }

    await request.post('/spars/request').set(judge.authHeader).send({ sparId, role: 'judge' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: judge.user.id });

    const pool = getPool();
    const leadTime = new Date(Date.now() + 600 * 1000);
    await pool.query('UPDATE spars SET time = $1 WHERE id = $2', [leadTime, sparId]);
    await pool.query('UPDATE spar_members SET status = $1 WHERE spar_id = $2 AND user_id = $3', ['accepted', sparId, judge.user.id]);

    await request.post('/spars/start-debate').set(host.authHeader).send({ sparId });
    await request.post('/spars/start-evaluation').set(host.authHeader).send({ sparId });

    const ballotPayload = {
      sparId,
      teams: {
        Proposition: [
          { userId: debaters[0].user.id, score: 75 },
          { userId: debaters[1].user.id, score: 74 },
          { userId: debaters[2].user.id, score: 73 }
        ],
        Opposition: [
          { userId: debaters[3].user.id, score: 72 },
          { userId: debaters[4].user.id, score: 71 },
          { userId: debaters[5].user.id, score: 70 }
        ]
      }
    };

    // First ballot — should succeed
    const first = await request.post('/evaluations/ballot').set(judge.authHeader).send(ballotPayload);
    expect(first.status).toBe(200);

    // Second ballot — should be rejected
    const second = await request.post('/evaluations/ballot').set(judge.authHeader).send(ballotPayload);
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('should reject a ballot with tied team scores', async () => {
    const host = await createAuthenticatedUser({ username: 'tie_host' });
    const debaters = [host];
    for (let i = 2; i <= 6; i++) {
      debaters.push(await createAuthenticatedUser({ username: `tie_d${i}` }));
    }
    const judge = await createAuthenticatedUser({ username: 'tie_judge' });

    for (const d of debaters) await seedBalance(d.user.id, 50);
    await seedBalance(judge.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Tied Score Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: true,
      expectedJudgeLevel: 'novice',
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    for (let i = 1; i < debaters.length; i++) {
      await request.post('/spars/request').set(debaters[i].authHeader).send({ sparId, role: 'debater' });
      await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: debaters[i].user.id });
    }

    await request.post('/spars/request').set(judge.authHeader).send({ sparId, role: 'judge' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: judge.user.id });

    const pool = getPool();
    const leadTime = new Date(Date.now() + 600 * 1000);
    await pool.query('UPDATE spars SET time = $1 WHERE id = $2', [leadTime, sparId]);
    await pool.query('UPDATE spar_members SET status = $1 WHERE spar_id = $2 AND user_id = $3', ['accepted', sparId, judge.user.id]);

    await request.post('/spars/start-debate').set(host.authHeader).send({ sparId });
    await request.post('/spars/start-evaluation').set(host.authHeader).send({ sparId });

    // Both teams total to 222 — tied scores
    const res = await request.post('/evaluations/ballot').set(judge.authHeader).send({
      sparId,
      teams: {
        Proposition: [
          { userId: debaters[0].user.id, score: 75 },
          { userId: debaters[1].user.id, score: 74 },
          { userId: debaters[2].user.id, score: 73 }
        ],
        Opposition: [
          { userId: debaters[3].user.id, score: 76 },
          { userId: debaters[4].user.id, score: 74 },
          { userId: debaters[5].user.id, score: 72 }
        ]
      }
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should reject a ballot with out-of-range scores', async () => {
    const host = await createAuthenticatedUser({ username: 'range_host' });
    const debaters = [host];
    for (let i = 2; i <= 6; i++) {
      debaters.push(await createAuthenticatedUser({ username: `range_d${i}` }));
    }
    const judge = await createAuthenticatedUser({ username: 'range_judge' });

    for (const d of debaters) await seedBalance(d.user.id, 50);
    await seedBalance(judge.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Out of Range Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: true,
      expectedJudgeLevel: 'novice',
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    for (let i = 1; i < debaters.length; i++) {
      await request.post('/spars/request').set(debaters[i].authHeader).send({ sparId, role: 'debater' });
      await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: debaters[i].user.id });
    }

    await request.post('/spars/request').set(judge.authHeader).send({ sparId, role: 'judge' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: judge.user.id });

    const pool = getPool();
    const leadTime = new Date(Date.now() + 600 * 1000);
    await pool.query('UPDATE spars SET time = $1 WHERE id = $2', [leadTime, sparId]);
    await pool.query('UPDATE spar_members SET status = $1 WHERE spar_id = $2 AND user_id = $3', ['accepted', sparId, judge.user.id]);

    await request.post('/spars/start-debate').set(host.authHeader).send({ sparId });
    await request.post('/spars/start-evaluation').set(host.authHeader).send({ sparId });

    // Score of 85 exceeds the 60–80 valid range
    const res = await request.post('/evaluations/ballot').set(judge.authHeader).send({
      sparId,
      teams: {
        Proposition: [
          { userId: debaters[0].user.id, score: 85 },
          { userId: debaters[1].user.id, score: 74 },
          { userId: debaters[2].user.id, score: 73 }
        ],
        Opposition: [
          { userId: debaters[3].user.id, score: 72 },
          { userId: debaters[4].user.id, score: 71 },
          { userId: debaters[5].user.id, score: 70 }
        ]
      }
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should refund ALL debaters (accepted + pending) when spar is cancelled', async () => {
    const host = await createAuthenticatedUser({ username: 'mix_cancel_host' });
    const accepted = await createAuthenticatedUser({ username: 'mix_accepted' });
    const pending = await createAuthenticatedUser({ username: 'mix_pending' });

    await seedBalance(host.user.id, 50);
    await seedBalance(accepted.user.id, 50);
    await seedBalance(pending.user.id, 50);

    const futureTime = new Date(Date.now() + 7200 * 1000);
    const timeStr = formatSparDate(futureTime);

    const createRes = await request.post('/spars').set(host.authHeader).send({
      name: 'Mixed Cancel Test',
      time: timeStr,
      rule: 'wsdc',
      expectedDebaterLevel: 'open',
      expectingJudge: false,
      role: 'debater'
    });
    const sparId = createRes.body.sparId;

    // One debater gets accepted
    await request.post('/spars/request').set(accepted.authHeader).send({ sparId, role: 'debater' });
    await request.post('/spars/accept').set(host.authHeader).send({ sparId, targetUserId: accepted.user.id });

    // Another debater stays pending (no accept call)
    await request.post('/spars/request').set(pending.authHeader).send({ sparId, role: 'debater' });

    // Verify both have frozen balances
    expect((await getBalance(accepted.user.id)).frozen).toBe(10);
    expect((await getBalance(pending.user.id)).frozen).toBe(10);

    // Cancel the spar
    const cancelRes = await request.delete('/spars').set(host.authHeader).send({ sparId });
    expect(cancelRes.status).toBe(200);

    // All three (host + accepted + pending) should be fully refunded
    expect((await getBalance(host.user.id)).available).toBe(50);
    expect((await getBalance(host.user.id)).frozen).toBe(0);

    expect((await getBalance(accepted.user.id)).available).toBe(50);
    expect((await getBalance(accepted.user.id)).frozen).toBe(0);

    expect((await getBalance(pending.user.id)).available).toBe(50);
    expect((await getBalance(pending.user.id)).frozen).toBe(0);
  });
});

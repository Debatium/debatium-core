import { request, createAuthenticatedUser } from '../helpers.js';
import { getPool } from '../../extensions/db.js';

export async function setupDoneSpar() {
  const host = await createAuthenticatedUser();
  const judge = await createAuthenticatedUser();
  const debater1 = await createAuthenticatedUser();
  const debater2 = await createAuthenticatedUser();
  const d3 = await createAuthenticatedUser();
  const d4 = await createAuthenticatedUser();
  const d5 = await createAuthenticatedUser();

  // 1. Create spar via API
  const createRes = await request
    .post('/spars/')
    .set('Authorization', host.authHeader.Authorization)
    .send({
      name: `E2E Test Spar ${Math.random()}`,
      time: '10/04/2026 20:00', // Dummy time
      rule: 'wsdc',
      expectedDebaterLevel: 'novice',
      expectedJudgeLevel: 'novice',
      role: 'debater'
    })
    .expect(201);
  
  const sparId = createRes.body.sparId;

  // 2. Add members (total 6 debaters for WSDC to be 'ready')
  const members = [
    { user: judge, role: 'judge' },
    { user: debater1, role: 'debater' },
    { user: debater2, role: 'debater' },
    { user: d3, role: 'debater' },
    { user: d4, role: 'debater' },
    { user: d5, role: 'debater' }
  ];

  for (const m of members) {
    await request
      .post('/spars/invite')
      .set('Authorization', host.authHeader.Authorization)
      .send({ sparId, userId: m.user.user.id, role: m.role })
      .expect(200);

    await request
      .post('/spars/accept')
      .set('Authorization', m.user.authHeader.Authorization)
      .send({ sparId })
      .expect(200);
  }

  // 3. Force status to 'ready' and move time to 31 mins past start via DB
  const pool = getPool();
  const pastTime = new Date(Date.now() - 31 * 60 * 1000); 
  await pool.query(
    `UPDATE spars SET time = $1, status = 'ready' WHERE id = $2`, 
    [pastTime, sparId]
  );

  // 4. Trigger evaluation API - should work now at 31 mins
  await request
    .get(`/evaluations?sparId=${sparId}`)
    .set('Authorization', debater1.authHeader.Authorization)
    .expect(200);
  
  return {
    sparId,
    host,
    judge,
    debater1,
    debater2,
    extras: [d3, d4, d5]
  };
}

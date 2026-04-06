import { describe, it, expect, beforeEach } from "vitest";
import { request, createAuthenticatedUser } from "../helpers.js";
import { getPool } from "../../extensions/db.js";

describe("Spar Evaluation Schema Validation", () => {
  let host: any, judge: any;
  let sparId: string;

  async function setupSpar(rule: "bp" | "wsdc") {
    host = await createAuthenticatedUser();
    judge = await createAuthenticatedUser();

    // 1. Create spar
    const createRes = await request
      .post("/spars/")
      .set("Authorization", host.authHeader.Authorization)
      .send({
        name: `Schema Test ${rule.toUpperCase()} ${Math.random().toString(36).substring(7)}`,
        time: "10/04/2026 20:00",
        rule,
        expectedDebaterLevel: "novice",
        expectedJudgeLevel: "novice",
        role: "debater",
      })
      .expect(201);

    sparId = createRes.body.sparId;

    // 2. Add judge
    await request
      .post("/spars/invite")
      .set("Authorization", host.authHeader.Authorization)
      .send({ sparId, userId: judge.user.id, role: "judge" })
      .expect(200);
    await request
      .post("/spars/accept")
      .set("Authorization", judge.authHeader.Authorization)
      .send({ sparId })
      .expect(200);

    const debaters: any[] = [];
    const debaterCount = rule === "bp" ? 7 : 5; // 7+1 (host) = 8 for BP, 5+1 (host) = 6 for WSDC

    for (let i = 0; i < debaterCount; i++) {
      const d = await createAuthenticatedUser();
      debaters.push(d);
      await request
        .post("/spars/invite")
        .set("Authorization", host.authHeader.Authorization)
        .send({ sparId, userId: d.user.id, role: "debater" })
        .expect(200);
      await request
        .post("/spars/accept")
        .set("Authorization", d.authHeader.Authorization)
        .send({ sparId })
        .expect(200);
    }

    // 3. Force status and move time via DB (no way to skip 30 mins via API)
    const pool = getPool();
    const pastTime = new Date(Date.now() - 35 * 60 * 1000);
    await pool.query(
      `UPDATE spars SET time = $1, status = 'ready' WHERE id = $2`,
      [pastTime, sparId],
    );

    return { host, judge, debaters };
  }

  describe("BP Format Validation", () => {
    it("should match BallotResponse exactly for BP match", async () => {
      const { host, judge, debaters } = await setupSpar("bp");
      const allDebaters = [host, ...debaters]; // 8 total

      // Submit BP Ballot with specific data
      const ballotPayload = {
        sparId,
        teams: {
          OG: [
            {
              userId: allDebaters[0].user.id,
              score: 75.5,
              reason: "Strong arguments",
            },
            { userId: allDebaters[1].user.id, score: 76 },
          ],
          OO: [
            {
              userId: allDebaters[2].user.id,
              score: 77.5,
              reason: "Good engagement",
            },
            { userId: allDebaters[3].user.id, score: 78 },
          ],
          CG: [
            {
              userId: allDebaters[4].user.id,
              score: 79,
              reason: "Excellent summary",
            },
            { userId: allDebaters[5].user.id, score: 80 },
          ],
          CO: [
            { userId: allDebaters[6].user.id, score: 71 },
            { userId: allDebaters[7].user.id, score: 72 },
          ],
        },
      };

      await request
        .post("/spars/ballot")
        .set("Authorization", judge.authHeader.Authorization)
        .send(ballotPayload)
        .expect(200);

      const res = await request
        .get(`/spars/evaluation?sparId=${sparId}`)
        .set("Authorization", host.authHeader.Authorization)
        .expect(200);

      const b = res.body.ballot;

      // 1. Root and Ballot Metadata
      expect(res.body.status).toBe("complete");
      expect(b.sparId).toBe(sparId);
      expect(b.judgeId).toBe(judge.user.id);

      // 2. Exact Results Matching
      for (const team of ["OG", "OO", "CG", "CO"] as const) {
        const expectedTeam = ballotPayload.teams[team];
        const receivedTeam = b.resultsJson.teams[team];
        expect(receivedTeam).toHaveLength(2);

        expectedTeam.forEach((expectedS, idx) => {
          const receivedS = receivedTeam[idx];
          expect(receivedS.userId).toBe(expectedS.userId);
          expect(receivedS.score).toBe(expectedS.score);
          expect(receivedS.reason || null).toBe(expectedS.reason || null);
        });
      }
      expect(b.resultsJson.replySpeeches).toBeNull();

      // 3. Exact Placements Matching (Computed Rankings)
      // CG: 79 + 80 = 159 (1st)
      // OO: 77.5 + 78 = 155.5 (2nd)
      // OG: 75.5 + 76 = 151.5 (3rd)
      // CO: 71 + 72 = 143 (4th)
      const expectedPlacements = [
        { team: "CG", totalScore: 159, rank: 1 },
        { team: "OO", totalScore: 155.5, rank: 2 },
        { team: "OG", totalScore: 151.5, rank: 3 },
        { team: "CO", totalScore: 143, rank: 4 },
      ];

      expect(b.placementsJson).toHaveLength(4);
      expect(b.placementsJson).toEqual(
        expect.arrayContaining(
          expectedPlacements.map((p) => expect.objectContaining(p)),
        ),
      );

      // Check sorting order
      const ranks = b.placementsJson.map((p: any) => p.rank);
      expect(ranks).toEqual([1, 2, 3, 4]);

      b.placementsJson.forEach((p: any) => {
        const expected = expectedPlacements.find((ep) => ep.team === p.team)!;
        expect(p.totalScore).toBe(expected.totalScore);
        expect(p.rank).toBe(expected.rank);
      });
    });
  });

  describe("WSDC Format Validation", () => {
    it("should match BallotResponse exactly for WSDC with reply speeches", async () => {
      const { host, judge, debaters } = await setupSpar("wsdc");
      const allDebaters = [host, ...debaters]; // 6 total

      // Submit WSDC Ballot
      const ballotPayload = {
        sparId,
        teams: {
          Proposition: [
            {
              userId: allDebaters[0].user.id,
              score: 70,
              reason: "Solid opening",
            },
            { userId: allDebaters[1].user.id, score: 71 },
            { userId: allDebaters[2].user.id, score: 72 },
          ],
          Opposition: [
            {
              userId: allDebaters[3].user.id,
              score: 75,
              reason: "Great logic",
            },
            { userId: allDebaters[4].user.id, score: 76 },
            { userId: allDebaters[5].user.id, score: 77.5 },
          ],
        },
        replySpeeches: {
          Proposition: { userId: allDebaters[0].user.id, score: 35.5 },
          Opposition: {
            userId: allDebaters[3].user.id,
            score: 38,
            reason: "Decisive strike",
          },
        },
      };

      await request
        .post("/spars/ballot")
        .set("Authorization", judge.authHeader.Authorization)
        .send(ballotPayload)
        .expect(200);

      const res = await request
        .get(`/spars/evaluation?sparId=${sparId}`)
        .set("Authorization", debaters[0].authHeader.Authorization)
        .expect(200);

      const b = res.body.ballot;

      // 1. Exact Speakers Matching
      for (const team of ["Proposition", "Opposition"] as const) {
        const expectedTeam = ballotPayload.teams[team];
        const receivedTeam = b.resultsJson.teams[team];
        expect(receivedTeam).toHaveLength(3);
        expectedTeam.forEach((expectedS, idx) => {
          expect(receivedTeam[idx].userId).toBe(expectedS.userId);
          expect(receivedTeam[idx].score).toBe(expectedS.score);
          expect(receivedTeam[idx].reason || null).toBe(
            expectedS.reason || null,
          );
        });
      }

      // 2. Exact Reply Speeches Matching
      const expectedRS = ballotPayload.replySpeeches;
      const receivedRS = b.resultsJson.replySpeeches;
      expect(receivedRS.Proposition.userId).toBe(expectedRS.Proposition.userId);
      expect(receivedRS.Proposition.score).toBe(expectedRS.Proposition.score);
      expect(receivedRS.Opposition.userId).toBe(expectedRS.Opposition.userId);
      expect(receivedRS.Opposition.score).toBe(expectedRS.Opposition.score);
      expect(receivedRS.Opposition.reason).toBe(expectedRS.Opposition.reason);

      // 3. Exact Placements Matching
      // Prop: 70+71+72 + 35.5 = 248.5
      // Opp: 75+76+77.5 + 38 = 266.5
      expect(b.placementsJson).toHaveLength(2);
      const top = b.placementsJson[0];
      const bot = b.placementsJson[1];

      expect(top.team).toBe("Opposition");
      expect(top.totalScore).toBe(266.5);
      expect(top.rank).toBe(1);

      expect(bot.team).toBe("Proposition");
      expect(bot.totalScore).toBe(248.5);
      expect(bot.rank).toBe(2);
    });
  });

  describe("Feedback & Sanitization Validation", () => {
    it("should correctly sanitize and match feedback data exactly", async () => {
      const { host, judge, debaters } = await setupSpar("bp");
      const debater1 = host;
      const debater2 = debaters[0];

      // 1. Submit feedbacks
      const fb1 = {
        sparId,
        rating: 9.5,
        comment: "Excellent feedback.",
        isAnonymous: false,
      };
      const fb2 = {
        sparId,
        rating: 2.5,
        comment: "I disagree with your stance.",
        isAnonymous: true,
      };

      await request
        .post("/spars/feedback")
        .set("Authorization", debater1.authHeader.Authorization)
        .send(fb1)
        .expect(200);
      await request
        .post("/spars/feedback")
        .set("Authorization", debater2.authHeader.Authorization)
        .send(fb2)
        .expect(200);

      // Submit ballot to unlock feedback
      await request
        .post("/spars/ballot")
        .set("Authorization", judge.authHeader.Authorization)
        .send({
          sparId,
          teams: {
            OG: [
              { userId: debater1.user.id, score: 70 },
              { userId: debater2.user.id, score: 71 },
            ],
            OO: [
              { userId: debaters[1].user.id, score: 72 },
              { userId: debaters[2].user.id, score: 73 },
            ],
            CG: [
              { userId: debaters[3].user.id, score: 74 },
              { userId: debaters[4].user.id, score: 75 },
            ],
            CO: [
              { userId: debaters[5].user.id, score: 76 },
              { userId: debaters[6].user.id, score: 77 },
            ],
          },
        })
        .expect(200);

      const res = await request
        .get(`/spars/evaluation?sparId=${sparId}`)
        .set("Authorization", judge.authHeader.Authorization)
        .expect(200);

      const fbs = res.body.feedbacks;
      expect(fbs).toHaveLength(2);

      const publicFB = fbs.find((f: any) => !f.isAnonymous);
      const anonFB = fbs.find((f: any) => f.isAnonymous);

      // Verify Public FB Data
      expect(publicFB.rating).toBe(fb1.rating);
      expect(publicFB.comment).toBe(fb1.comment);
      expect(publicFB.debaterId).toBe(debater1.user.id);
      expect(publicFB.username).toBe(debater1.user.username);
      expect(publicFB.avatarURL).toBeDefined();

      // Verify Anonymous FB Data (omitted fields)
      expect(anonFB.rating).toBe(fb2.rating);
      expect(anonFB.comment).toBe(fb2.comment);
      expect(anonFB.debaterId).toBeUndefined();
      expect(anonFB.username).toBeUndefined();
      expect(anonFB.avatarURL).toBeUndefined();
    });
  });
});

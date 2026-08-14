import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const createdGuestIds: string[] = [];

function newGuestId(): string {
  const id = randomUUID();
  createdGuestIds.push(id);
  return id;
}

beforeAll(() => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      "Integration tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local)."
    );
  }
});

afterEach(async () => {
  const ids = createdGuestIds.splice(0);
  if (ids.length === 0) return;

  await admin.from("matchmaking_queue").delete().in("guest_id", ids);

  const { data: results } = await admin
    .from("match_results")
    .select("match_id")
    .in("player_id", ids);

  const matchIds = [...new Set((results ?? []).map((r) => r.match_id))];
  if (matchIds.length > 0) {
    await admin.from("match_rounds").delete().in("match_id", matchIds);
    await admin.from("match_results").delete().in("match_id", matchIds);
    await admin.from("matches").delete().in("id", matchIds);
  }
});

async function formMatch(category: string, count = 4) {
  const guests = Array.from({ length: count }, () => newGuestId());
  let lastResult: { match_id: string | null; first_round_id: string | null } | undefined;

  for (const guestId of guests) {
    const { data, error } = await admin.rpc("matchmaking_try_form_match", {
      p_guest_id: guestId,
      p_category: category,
    });
    expect(error).toBeNull();
    lastResult = data?.[0];
  }

  return { guests, result: lastResult! };
}

describe("matchmaking_try_form_match", () => {
  it("keeps guests waiting until 4 have joined the same category", async () => {
    const { guests, result } = await formMatch("football", 3);
    expect(result.match_id).toBeNull();

    const { data: queueRows } = await admin
      .from("matchmaking_queue")
      .select("category")
      .in("guest_id", guests);
    expect(queueRows).toHaveLength(3);
    expect(queueRows!.every((r) => r.category === "football")).toBe(true);
  });

  it("forms a 4-player match once the 4th guest joins, with round 1 created", async () => {
    const { guests, result } = await formMatch("football", 4);

    expect(result.match_id).toBeTruthy();
    expect(result.first_round_id).toBeTruthy();

    const { data: queueRows } = await admin
      .from("matchmaking_queue")
      .select("*")
      .in("guest_id", guests);
    expect(queueRows).toHaveLength(0);

    const { data: participants } = await admin
      .from("match_results")
      .select("player_id, is_bot, score")
      .eq("match_id", result.match_id);
    expect(participants).toHaveLength(4);
    expect(participants!.every((p) => p.is_bot === false && p.score === 0)).toBe(true);
    expect(new Set(participants!.map((p) => p.player_id))).toEqual(new Set(guests));

    const { data: match } = await admin
      .from("matches")
      .select("question_count, question_duration_ms, category")
      .eq("id", result.match_id)
      .single();
    expect(match).toMatchObject({ question_count: 10, question_duration_ms: 5000, category: "football" });

    const { data: round } = await admin
      .from("match_rounds")
      .select("round_number, expires_at, started_at")
      .eq("id", result.first_round_id)
      .single();
    expect(round?.round_number).toBe(1);
    expect(new Date(round!.expires_at).getTime() - new Date(round!.started_at).getTime()).toBe(5000);
  });

  it("does not mix guests from different categories into one match", async () => {
    await formMatch("football", 3);
    const { result } = await formMatch("general_knowledge", 1);
    expect(result.match_id).toBeNull();
  });
});

describe("matchmaking_bot_fallback", () => {
  it("does nothing before the 15s wait threshold", async () => {
    const guestId = newGuestId();
    await admin.rpc("matchmaking_try_form_match", { p_guest_id: guestId, p_category: "football" });

    const { data } = await admin.rpc("matchmaking_bot_fallback", { p_guest_id: guestId });
    expect(data?.[0]?.match_id).toBeNull();
  });

  it("fills remaining seats with bots after 15s, keeping every waiting human", async () => {
    const guests = [newGuestId(), newGuestId()];
    for (const guestId of guests) {
      await admin.rpc("matchmaking_try_form_match", { p_guest_id: guestId, p_category: "football" });
    }
    await admin
      .from("matchmaking_queue")
      .update({ joined_at: new Date(Date.now() - 16_000).toISOString() })
      .in("guest_id", guests);

    const { data, error } = await admin.rpc("matchmaking_bot_fallback", { p_guest_id: guests[0] });
    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.match_id).toBeTruthy();

    const { data: participants } = await admin
      .from("match_results")
      .select("player_id, is_bot")
      .eq("match_id", row.match_id);
    expect(participants).toHaveLength(4);

    const humanIds = participants!.filter((p) => !p.is_bot).map((p) => p.player_id);
    expect(new Set(humanIds)).toEqual(new Set(guests));
    expect(participants!.filter((p) => p.is_bot)).toHaveLength(2);

    const { data: queueRows } = await admin
      .from("matchmaking_queue")
      .select("*")
      .in("guest_id", guests);
    expect(queueRows).toHaveLength(0);
  });

  it("does nothing for a guest not in the queue", async () => {
    const guestId = newGuestId();
    const { data } = await admin.rpc("matchmaking_bot_fallback", { p_guest_id: guestId });
    expect(data?.[0]?.match_id).toBeNull();
  });
});

describe("submit_answer + advance_match_round", () => {
  async function createMatch() {
    const { guests, result } = await formMatch("football", 4);
    const { data: round } = await admin
      .from("match_rounds")
      .select("question_id")
      .eq("id", result.first_round_id)
      .single();
    const { data: question } = await admin
      .from("questions")
      .select("correct_answer_index")
      .eq("id", round!.question_id)
      .single();

    return {
      guests,
      matchId: result.match_id as string,
      roundId: result.first_round_id as string,
      correctIndex: question!.correct_answer_index as number,
    };
  }

  it("claims the round, increments score, and creates round 2", async () => {
    const { guests, matchId, roundId, correctIndex } = await createMatch();

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guests[0],
      p_answer_index: correctIndex,
    });

    expect(data?.[0]).toMatchObject({ correct: true, claimed: true, match_ended: false });
    expect(data?.[0].next_round_id).toBeTruthy();

    const { data: score } = await admin
      .from("match_results")
      .select("score")
      .eq("match_id", matchId)
      .eq("player_id", guests[0])
      .single();
    expect(score?.score).toBe(1);

    const { data: round2 } = await admin
      .from("match_rounds")
      .select("round_number")
      .eq("id", data![0].next_round_id)
      .single();
    expect(round2?.round_number).toBe(2);
  });

  it("does not let a second correct answer double-claim the same round", async () => {
    const { guests, roundId, correctIndex } = await createMatch();

    await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guests[0],
      p_answer_index: correctIndex,
    });

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guests[1],
      p_answer_index: correctIndex,
    });

    expect(data?.[0]).toMatchObject({ correct: true, claimed: false });
  });

  it("does not award a wrong answer", async () => {
    const { guests, roundId, correctIndex } = await createMatch();
    const wrongIndex = correctIndex === 0 ? 1 : 0;

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guests[0],
      p_answer_index: wrongIndex,
    });

    expect(data?.[0]).toMatchObject({ correct: false, claimed: false });
  });

  it("ends the match after question_count rounds instead of advancing", async () => {
    const { guests, matchId, roundId, correctIndex } = await createMatch();

    await admin.from("matches").update({ question_count: 1 }).eq("id", matchId);

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guests[0],
      p_answer_index: correctIndex,
    });

    expect(data?.[0]).toMatchObject({
      correct: true,
      claimed: true,
      match_ended: true,
      next_round_id: null,
    });

    const { data: match } = await admin
      .from("matches")
      .select("ended_at")
      .eq("id", matchId)
      .single();
    expect(match?.ended_at).not.toBeNull();
  });
});

describe("expire_round", () => {
  it("does not advance before expires_at", async () => {
    const { result } = await formMatch("general_knowledge", 4);

    const { data } = await admin.rpc("expire_round", { p_round_id: result.first_round_id });
    expect(data?.[0]).toMatchObject({ match_ended: false, next_round_id: null });
  });

  it("advances to the next round once expired, with no winner recorded", async () => {
    const { result } = await formMatch("general_knowledge", 4);

    await admin
      .from("match_rounds")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", result.first_round_id);

    const { data } = await admin.rpc("expire_round", { p_round_id: result.first_round_id });
    expect(data?.[0].match_ended).toBe(false);
    expect(data?.[0].next_round_id).toBeTruthy();

    const { data: round1 } = await admin
      .from("match_rounds")
      .select("winner_guest_id")
      .eq("id", result.first_round_id)
      .single();
    expect(round1?.winner_guest_id).toBeNull();
  });

  it("is a no-op if the round was already claimed", async () => {
    const { guests, result } = await formMatch("general_knowledge", 4);
    const { data: round } = await admin
      .from("match_rounds")
      .select("question_id")
      .eq("id", result.first_round_id)
      .single();
    const { data: question } = await admin
      .from("questions")
      .select("correct_answer_index")
      .eq("id", round!.question_id)
      .single();

    await admin.rpc("submit_answer", {
      p_round_id: result.first_round_id,
      p_guest_id: guests[0],
      p_answer_index: question!.correct_answer_index,
    });

    await admin
      .from("match_rounds")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", result.first_round_id);

    const { data } = await admin.rpc("expire_round", { p_round_id: result.first_round_id });
    expect(data?.[0]).toMatchObject({ match_ended: false, next_round_id: null });
  });
});

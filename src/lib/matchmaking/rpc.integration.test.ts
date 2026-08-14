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

  const { data: matches } = await admin
    .from("matches")
    .select("id")
    .in("player_1_id", ids);

  const matchIds = (matches ?? []).map((m) => m.id);
  if (matchIds.length > 0) {
    await admin.from("match_rounds").delete().in("match_id", matchIds);
    await admin.from("matches").delete().in("id", matchIds);
  }
});

describe("matchmaking_try_pair", () => {
  it("queues a lone guest with no opponent", async () => {
    const guestId = newGuestId();

    const { data, error } = await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guestId,
      p_category: "football",
    });

    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ match_id: null, opponent_id: null });

    const { data: queueRow } = await admin
      .from("matchmaking_queue")
      .select("*")
      .eq("guest_id", guestId)
      .maybeSingle();
    expect(queueRow?.category).toBe("football");
  });

  it("pairs two waiting guests in the same category and creates round 1", async () => {
    const guest1 = newGuestId();
    const guest2 = newGuestId();

    await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guest1,
      p_category: "football",
    });

    const { data, error } = await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guest2,
      p_category: "football",
    });

    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.match_id).toBeTruthy();
    expect(row?.opponent_id).toBe(guest1);
    expect(row?.first_round_id).toBeTruthy();

    const { data: queueRows } = await admin
      .from("matchmaking_queue")
      .select("*")
      .in("guest_id", [guest1, guest2]);
    expect(queueRows).toHaveLength(0);

    const { data: match } = await admin
      .from("matches")
      .select("*")
      .eq("id", row.match_id)
      .single();
    expect(match.player_1_id).toBe(guest1);
    expect(match.player_2_id).toBe(guest2);
    expect(match.category).toBe("football");
    expect(match.is_bot_match).toBe(false);
  });

  it("does not pair guests from different categories", async () => {
    const guest1 = newGuestId();
    const guest2 = newGuestId();

    await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guest1,
      p_category: "football",
    });

    const { data } = await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guest2,
      p_category: "general_knowledge",
    });

    expect(data?.[0]?.match_id).toBeNull();
  });
});

describe("submit_answer", () => {
  async function createPairedMatch() {
    const guest1 = newGuestId();
    const guest2 = newGuestId();

    await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guest1,
      p_category: "football",
    });
    const { data } = await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guest2,
      p_category: "football",
    });
    const row = data![0];

    const { data: round } = await admin
      .from("match_rounds")
      .select("question_id")
      .eq("id", row.first_round_id)
      .single();
    const { data: question } = await admin
      .from("questions")
      .select("correct_answer_index")
      .eq("id", round!.question_id)
      .single();

    return {
      guest1,
      guest2,
      matchId: row.match_id as string,
      roundId: row.first_round_id as string,
      correctIndex: question!.correct_answer_index as number,
    };
  }

  it("claims the round for the first correct answer and advances", async () => {
    const { guest2, roundId, correctIndex } = await createPairedMatch();

    const { data, error } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guest2,
      p_answer_index: correctIndex,
    });

    expect(error).toBeNull();
    const row = data?.[0];
    expect(row).toMatchObject({ correct: true, claimed: true, match_ended: false });
    expect(row.next_round_id).toBeTruthy();
  });

  it("does not award a wrong answer", async () => {
    const { guest1, roundId, correctIndex } = await createPairedMatch();
    const wrongIndex = correctIndex === 0 ? 1 : 0;

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guest1,
      p_answer_index: wrongIndex,
    });

    expect(data?.[0]).toMatchObject({ correct: false, claimed: false });
  });

  it("does not let a second correct answer double-claim an already-won round", async () => {
    const { guest1, guest2, roundId, correctIndex } = await createPairedMatch();

    await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guest2,
      p_answer_index: correctIndex,
    });

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guest1,
      p_answer_index: correctIndex,
    });

    expect(data?.[0]).toMatchObject({ correct: true, claimed: false });
  });

  it("ends the match instead of advancing once 15s have elapsed", async () => {
    const { guest2, matchId, roundId, correctIndex } = await createPairedMatch();

    await admin
      .from("matches")
      .update({ started_at: new Date(Date.now() - 20_000).toISOString() })
      .eq("id", matchId);

    const { data } = await admin.rpc("submit_answer", {
      p_round_id: roundId,
      p_guest_id: guest2,
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

describe("matchmaking_bot_fallback", () => {
  it("does nothing if the guest hasn't waited 15s yet", async () => {
    const guestId = newGuestId();
    await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guestId,
      p_category: "football",
    });

    const { data } = await admin.rpc("matchmaking_bot_fallback", {
      p_guest_id: guestId,
    });

    expect(data?.[0]?.match_id).toBeNull();
  });

  it("pairs with a bot once the guest has waited 15s+", async () => {
    const guestId = newGuestId();
    await admin.rpc("matchmaking_try_pair", {
      p_guest_id: guestId,
      p_category: "football",
    });
    await admin
      .from("matchmaking_queue")
      .update({ joined_at: new Date(Date.now() - 16_000).toISOString() })
      .eq("guest_id", guestId);

    const { data, error } = await admin.rpc("matchmaking_bot_fallback", {
      p_guest_id: guestId,
    });

    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.match_id).toBeTruthy();
    expect(row?.opponent_id).toBeTruthy();
    expect(row?.first_round_id).toBeTruthy();

    const { data: match } = await admin
      .from("matches")
      .select("is_bot_match, player_1_id, player_2_id")
      .eq("id", row.match_id)
      .single();
    expect(match?.is_bot_match).toBe(true);
    expect(match?.player_1_id).toBe(guestId);

    const { data: queueRow } = await admin
      .from("matchmaking_queue")
      .select("*")
      .eq("guest_id", guestId)
      .maybeSingle();
    expect(queueRow).toBeNull();
  });

  it("does nothing if the guest isn't in the queue at all", async () => {
    const guestId = newGuestId();

    const { data } = await admin.rpc("matchmaking_bot_fallback", {
      p_guest_id: guestId,
    });

    expect(data?.[0]?.match_id).toBeNull();
  });
});

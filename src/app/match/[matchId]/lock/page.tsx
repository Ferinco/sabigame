import { notFound, redirect } from "next/navigation";
import { getMatch, getParticipants, getMyParticipantId } from "@/lib/match/actions";
import { LockScoreForm } from "@/components/match/LockScoreForm";

export default async function LockScorePage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const match = await getMatch(matchId);

  if (!match) {
    notFound();
  }

  const myPlayerId = await getMyParticipantId(matchId);
  const participants = await getParticipants(matchId);
  const me = participants.find((p) => p.playerId === myPlayerId);

  if (!match.endedAt || !me || me.isBot || me.isLocked) {
    redirect(`/match/${matchId}`);
  }

  return <LockScoreForm matchId={matchId} />;
}

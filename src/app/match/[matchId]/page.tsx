import { notFound } from "next/navigation";
import { getMatch, getCurrentRound, getParticipants, getMyParticipantId } from "@/lib/match/actions";
import { MatchRoom } from "@/components/match/MatchRoom";

export default async function MatchPage({
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
  const round = await getCurrentRound(matchId);
  const participants = await getParticipants(matchId);

  return (
    <MatchRoom
      matchId={matchId}
      guestId={myPlayerId}
      questionCount={match.questionCount}
      initialRound={round}
      initialParticipants={participants}
      initialMatchEnded={match.endedAt !== null}
    />
  );
}

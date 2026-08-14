import { notFound } from "next/navigation";
import { getGuestId } from "@/lib/guest/session";
import { getMatch, getCurrentRound } from "@/lib/match/actions";
import { MatchRoom } from "@/components/match/MatchRoom";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const guestId = await getGuestId();
  const match = await getMatch(matchId);

  if (!match) {
    notFound();
  }

  const round = await getCurrentRound(matchId);

  return (
    <MatchRoom
      matchId={matchId}
      guestId={guestId}
      startedAt={match.startedAt}
      initialRound={round}
      isBotMatch={match.isBotMatch}
    />
  );
}

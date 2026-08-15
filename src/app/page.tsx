import { getGuestId, getGuestNickname } from "@/lib/guest/session";
import { Landing } from "@/components/Landing";

export default async function Home() {
  const guestId = await getGuestId();
  const nickname = await getGuestNickname(guestId);

  return <Landing initialNickname={nickname} />;
}

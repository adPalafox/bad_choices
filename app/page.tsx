import { LandingPage } from "@/components/landing-page";
import { getScenarioPacks } from "@/lib/content";

export default function HomePage() {
  return <LandingPage packs={getScenarioPacks()} />;
}

import { NextStudio } from "next-sanity/studio";
import config from "../../../../sanity.config";

export const dynamic = "force-static";
export { metadata, viewport } from "next-sanity/studio";

/** Sanity Studio: where admins edit brands, prices, payment options, pages and announcements. */
export default function StudioPage() {
  return <NextStudio config={config} />;
}

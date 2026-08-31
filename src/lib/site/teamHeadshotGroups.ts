/**
 * Canonical list of team headshot source groups.
 *
 * Single source of truth consumed by:
 *   - `src/routes/site.index.tsx` (the leadership grid)
 *   - `src/routes/__root.tsx`      (app-wide startup health check)
 *   - `TeamHeadshotHealthPanel`    (dev-only re-check UI)
 *
 * Keeping the groups here (instead of inline in `site.index.tsx`) lets the
 * startup health check run on every page load — not only when a user
 * happens to navigate to `/site` — so CDN 404s on the AVIF/WebP/JPG
 * variants surface immediately in the console for QA, regardless of the
 * entry route.
 */
import teamMushtaqAsset from "@/assets/site/team-mushtaq.jpg.asset.json";
import teamMushtaq320Avif from "@/assets/site/team-mushtaq-320.avif?url";
import teamMushtaq480Avif from "@/assets/site/team-mushtaq-480.avif?url";
import teamMushtaq640Avif from "@/assets/site/team-mushtaq-640.avif?url";
import teamMushtaq800Avif from "@/assets/site/team-mushtaq-800.avif?url";
import teamMushtaq1000Avif from "@/assets/site/team-mushtaq-1000.avif?url";
import teamMushtaq1200Avif from "@/assets/site/team-mushtaq-1200.avif?url";
import teamMushtaq1600Avif from "@/assets/site/team-mushtaq-1600.avif?url";
import teamMushtaq320Webp from "@/assets/site/team-mushtaq-320.webp?url";
import teamMushtaq480Webp from "@/assets/site/team-mushtaq-480.webp?url";
import teamMushtaq640Webp from "@/assets/site/team-mushtaq-640.webp?url";
import teamMushtaq800Webp from "@/assets/site/team-mushtaq-800.webp?url";
import teamMushtaq1000Webp from "@/assets/site/team-mushtaq-1000.webp?url";
import teamMushtaq1200Webp from "@/assets/site/team-mushtaq-1200.webp?url";
import teamMushtaq1600Webp from "@/assets/site/team-mushtaq-1600.webp?url";

import teamDanish from "@/assets/site/team-danish.jpg";
import teamDanish320Avif from "@/assets/site/team-danish-320.avif?url";
import teamDanish480Avif from "@/assets/site/team-danish-480.avif?url";
import teamDanish640Avif from "@/assets/site/team-danish-640.avif?url";
import teamDanish800Avif from "@/assets/site/team-danish-800.avif?url";
import teamDanish1000Avif from "@/assets/site/team-danish-1000.avif?url";
import teamDanish1200Avif from "@/assets/site/team-danish-1200.avif?url";
import teamDanish1600Avif from "@/assets/site/team-danish-1600.avif?url";
import teamDanish320Webp from "@/assets/site/team-danish-320.webp?url";
import teamDanish480Webp from "@/assets/site/team-danish-480.webp?url";
import teamDanish640Webp from "@/assets/site/team-danish-640.webp?url";
import teamDanish800Webp from "@/assets/site/team-danish-800.webp?url";
import teamDanish1000Webp from "@/assets/site/team-danish-1000.webp?url";
import teamDanish1200Webp from "@/assets/site/team-danish-1200.webp?url";
import teamDanish1600Webp from "@/assets/site/team-danish-1600.webp?url";

import teamSaeed from "@/assets/site/team-saeed.jpg";
import teamSaeed320Avif from "@/assets/site/team-saeed-320.avif?url";
import teamSaeed480Avif from "@/assets/site/team-saeed-480.avif?url";
import teamSaeed640Avif from "@/assets/site/team-saeed-640.avif?url";
import teamSaeed800Avif from "@/assets/site/team-saeed-800.avif?url";
import teamSaeed320Webp from "@/assets/site/team-saeed-320.webp?url";
import teamSaeed480Webp from "@/assets/site/team-saeed-480.webp?url";
import teamSaeed640Webp from "@/assets/site/team-saeed-640.webp?url";
import teamSaeed800Webp from "@/assets/site/team-saeed-800.webp?url";

import type { HeadshotSourceGroup } from "@/lib/site/teamHeadshotHealthCheck";

const teamMushtaq = teamMushtaqAsset.url;

export const teamMushtaqAvifSrcSet = `${teamMushtaq320Avif} 320w, ${teamMushtaq480Avif} 480w, ${teamMushtaq640Avif} 640w, ${teamMushtaq800Avif} 800w, ${teamMushtaq1000Avif} 1000w, ${teamMushtaq1200Avif} 1200w, ${teamMushtaq1600Avif} 1600w`;
export const teamMushtaqWebpSrcSet = `${teamMushtaq320Webp} 320w, ${teamMushtaq480Webp} 480w, ${teamMushtaq640Webp} 640w, ${teamMushtaq800Webp} 800w, ${teamMushtaq1000Webp} 1000w, ${teamMushtaq1200Webp} 1200w, ${teamMushtaq1600Webp} 1600w`;
export const teamDanishAvifSrcSet = `${teamDanish320Avif} 320w, ${teamDanish480Avif} 480w, ${teamDanish640Avif} 640w, ${teamDanish800Avif} 800w, ${teamDanish1000Avif} 1000w, ${teamDanish1200Avif} 1200w, ${teamDanish1600Avif} 1600w`;
export const teamDanishWebpSrcSet = `${teamDanish320Webp} 320w, ${teamDanish480Webp} 480w, ${teamDanish640Webp} 640w, ${teamDanish800Webp} 800w, ${teamDanish1000Webp} 1000w, ${teamDanish1200Webp} 1200w, ${teamDanish1600Webp} 1600w`;
export const teamSaeedAvifSrcSet = `${teamSaeed320Avif} 320w, ${teamSaeed480Avif} 480w, ${teamSaeed640Avif} 640w, ${teamSaeed800Avif} 800w`;
export const teamSaeedWebpSrcSet = `${teamSaeed320Webp} 320w, ${teamSaeed480Webp} 480w, ${teamSaeed640Webp} 640w, ${teamSaeed800Webp} 800w`;

export { teamMushtaq, teamDanish, teamSaeed };

export const TEAM_HEADSHOT_GROUPS: readonly HeadshotSourceGroup[] = [
  {
    name: "Engr. Mushtaq Ahmad",
    fallback: teamMushtaq,
    avifSrcSet: teamMushtaqAvifSrcSet,
    webpSrcSet: teamMushtaqWebpSrcSet,
  },
  {
    name: "Engr. Danish Hayat",
    fallback: teamDanish,
    avifSrcSet: teamDanishAvifSrcSet,
    webpSrcSet: teamDanishWebpSrcSet,
  },
  {
    name: "Saeed ullah",
    fallback: teamSaeed,
    avifSrcSet: teamSaeedAvifSrcSet,
    webpSrcSet: teamSaeedWebpSrcSet,
  },
];

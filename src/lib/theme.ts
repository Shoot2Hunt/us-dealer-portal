/**
 * Theme presets and options, shared by the Sanity schema (option lists) and the portal
 * (CSS variables). Admins pick these in Studio → Appearance → Theme.
 */

export type Palette = {
  accent: string;
  accentDark: string;
  accentLight: string;
  accentSoft: string;
  ink: string;
  inkSoft: string;
  /** Far end of the header/footer gradient. */
  headerEnd: string;
  gold: string;
};

export const THEME_PRESETS = {
  rust: { title: "Rust (default)", palette: { accent: "#b4532a", accentDark: "#8f3f1e", accentLight: "#e0784a", accentSoft: "#fbeee7", ink: "#16181d", inkSoft: "#232730", headerEnd: "#3a2218", gold: "#e8a93a" } },
  blaze: { title: "Blaze orange", palette: { accent: "#e4572e", accentDark: "#b8401c", accentLight: "#f2845f", accentSoft: "#fdeee8", ink: "#1a1714", inkSoft: "#2a2420", headerEnd: "#3e2a1c", gold: "#f0b23c" } },
  forest: { title: "Forest green", palette: { accent: "#2f6b3a", accentDark: "#1f4a27", accentLight: "#4f9a5c", accentSoft: "#e9f3ea", ink: "#141a16", inkSoft: "#1f2a22", headerEnd: "#1f3324", gold: "#d4a83a" } },
  navy: { title: "Navy blue", palette: { accent: "#2557a7", accentDark: "#183d78", accentLight: "#4a82d6", accentSoft: "#e8effb", ink: "#121722", inkSoft: "#1c2433", headerEnd: "#142a4d", gold: "#e8b33a" } },
  crimson: { title: "Crimson", palette: { accent: "#b3242f", accentDark: "#8a1821", accentLight: "#e0505a", accentSoft: "#fbe9ea", ink: "#17151a", inkSoft: "#241f26", headerEnd: "#3d1418", gold: "#e8a93a" } },
  slate: { title: "Slate", palette: { accent: "#4b5563", accentDark: "#374151", accentLight: "#6b7280", accentSoft: "#eef0f3", ink: "#111827", inkSoft: "#1f2937", headerEnd: "#283040", gold: "#d6a23a" } },
} as const satisfies Record<string, { title: string; palette: Palette }>;

export type PresetKey = keyof typeof THEME_PRESETS;

/** Fonts are loaded with next/font in the root layout; these keys map to its CSS variables. */
export const HEADING_FONTS = {
  montserrat: "Montserrat",
  oswald: "Oswald",
  barlowCondensed: "Barlow Condensed",
  robotoSlab: "Roboto Slab",
  roboto: "Roboto",
} as const;
export const BODY_FONTS = { roboto: "Roboto", inter: "Inter", openSans: "Open Sans" } as const;

export const CORNER_STYLES = {
  sharp: { title: "Sharp", md: "0.125rem", lg: "0.25rem", xl: "0.375rem" },
  rounded: { title: "Rounded (default)", md: "0.375rem", lg: "0.5rem", xl: "0.75rem" },
  soft: { title: "Extra round", md: "0.625rem", lg: "0.875rem", xl: "1.25rem" },
} as const;

export type ThemeSettings = {
  preset?: string;
  /** Used when preset is "custom". */
  customAccent?: string;
  customInk?: string;
  customGold?: string;
  headingFont?: string;
  bodyFont?: string;
  corners?: string;
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Only exact #rrggbb values reach the CSS, so a Studio value can't inject anything. */
const hex = (v: string | undefined) => (v && HEX.test(v.trim()) ? v.trim() : null);

const mix = (color: string, other: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, ${other})`;

/** The :root CSS variables for the chosen theme. Defaults reproduce the built-in look. */
export function themeCss(t: ThemeSettings | null | undefined): string {
  const vars: Record<string, string> = {};

  if (t?.preset === "custom") {
    const accent = hex(t.customAccent) ?? THEME_PRESETS.rust.palette.accent;
    const ink = hex(t.customInk) ?? THEME_PRESETS.rust.palette.ink;
    Object.assign(vars, {
      "--color-accent": accent,
      "--color-accent-dark": mix(accent, "black", 78),
      "--color-accent-light": mix(accent, "white", 72),
      "--color-accent-soft": mix(accent, "white", 10),
      "--color-ink": ink,
      "--color-ink-soft": mix(ink, "white", 90),
      "--color-header-end": mix(accent, ink, 28),
      "--color-gold": hex(t.customGold) ?? THEME_PRESETS.rust.palette.gold,
    });
  } else if (t?.preset && t.preset in THEME_PRESETS && t.preset !== "rust") {
    const p: Palette = THEME_PRESETS[t.preset as PresetKey].palette;
    Object.assign(vars, {
      "--color-accent": p.accent,
      "--color-accent-dark": p.accentDark,
      "--color-accent-light": p.accentLight,
      "--color-accent-soft": p.accentSoft,
      "--color-ink": p.ink,
      "--color-ink-soft": p.inkSoft,
      "--color-header-end": p.headerEnd,
      "--color-gold": p.gold,
    });
  }

  if (t?.headingFont && t.headingFont in HEADING_FONTS && t.headingFont !== "montserrat") {
    vars["--font-display"] = `var(--font-${t.headingFont}), var(--font-roboto), ui-sans-serif, system-ui, sans-serif`;
  }
  if (t?.bodyFont && t.bodyFont in BODY_FONTS && t.bodyFont !== "roboto") {
    vars["--font-sans"] = `var(--font-${t.bodyFont}), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  }
  if (t?.corners && t.corners in CORNER_STYLES && t.corners !== "rounded") {
    const c = CORNER_STYLES[t.corners as keyof typeof CORNER_STYLES];
    Object.assign(vars, { "--radius-md": c.md, "--radius-lg": c.lg, "--radius-xl": c.xl });
  }

  const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
  return body ? `:root{${body}}` : "";
}

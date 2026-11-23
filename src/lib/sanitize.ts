import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Clean product HTML from WooCommerce before rendering it in the portal. Store content is
 * written by brand staff, but a compromised or careless store must not be able to run
 * script in a signed-in dealer's session.
 */
export function sanitizeProductHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  // WordPress page-builder shortcodes ([vc_row], [/et_pb_text] …) are noise outside WordPress.
  const withoutShortcodes = html.replace(/\[\/?[a-z][\w-]*(?:\s[^\]]*)?\]/gi, "");
  const clean = sanitizeHtml(withoutShortcodes, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "iframe"],
    allowedAttributes: {
      // target/rel/loading are set by transformTags below (they override any source value).
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      iframe: ["src", "title", "allow", "allowfullscreen"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https", "http"] },
    // Embedded product videos only.
    allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"],
    // An iframe whose src was rejected would render as an empty box.
    exclusiveFilter: (frame) => frame.tag === "iframe" && !frame.attribs.src,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
    },
  }).trim();
  return clean || null;
}

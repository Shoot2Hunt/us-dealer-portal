import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Clean product HTML from WooCommerce before rendering it in the portal. Store content is
 * written by brand staff, but a compromised or careless store must not be able to run
 * script in a signed-in dealer's session.
 */
/** A YouTube or Vimeo address → its embeddable player address, or null. */
function videoEmbedUrl(url: string): string | null {
  const yt = url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

/**
 * WordPress shows a video link on a line of its own as the video itself ("auto-embed").
 * Do the same here: such a line, or a paragraph holding only that link, becomes a player.
 */
function embedVideoLines(html: string): string {
  return html.replace(
    /(^|\n|<p>)\s*(?:<a [^>]*>)?\s*(https?:\/\/[^\s<"]+)\s*(?:<\/a>)?\s*(?=$|\n|<\/p>)/gi,
    (whole, before: string, url: string) => {
      const src = videoEmbedUrl(url);
      return src ? `${before}<iframe src="${src}" title="Product video" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>` : whole;
    },
  );
}

/**
 * The first couple of sentences of a description as plain text (no tags, links or video
 * addresses), cut at a word boundary. For a preview next to the price.
 */
export function descriptionExcerpt(html: string | null, max = 320): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(iframe|img|table|script|style)[\s\S]*?(<\/\1>|\/?>)/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).replace(/[\s,;:.–-]+$/, "")}…`;
}

export function sanitizeProductHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  // WordPress page-builder shortcodes ([vc_row], [/et_pb_text] …) are noise outside WordPress.
  const withoutShortcodes = embedVideoLines(html.replace(/\[\/?[a-z][\w-]*(?:\s[^\]]*)?\]/gi, ""));
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

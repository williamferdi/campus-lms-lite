import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const marked = new Marked({ gfm: true, breaks: false, async: false });

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "blockquote", "pre", "code",
    "ul", "ol", "li", "strong", "em", "del", "s", "sup", "sub", "a", "img", "figure",
    "figcaption", "table", "thead", "tbody", "tr", "th", "td", "span", "div", "iframe", "input",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    iframe: ["src", "title", "width", "height", "allow", "allowfullscreen", "loading"],
    th: ["align", "colspan", "rowspan"],
    td: ["align", "colspan", "rowspan"],
    code: ["class"],
    input: ["type", "checked", "disabled"],
    ol: ["start"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"], iframe: ["https"] },
  allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"],
  allowedClasses: { code: [/^language-[\w-]+$/] },
  exclusiveFilter: (frame) =>
    (frame.tag === "input" && frame.attribs.type !== "checkbox") || (frame.tag === "iframe" && !frame.attribs.src),
  transformTags: {
    a: (tagName, attribs) => {
      const external = /^https?:\/\//i.test(attribs.href ?? "");
      return {
        tagName,
        attribs: external ? { ...attribs, target: "_blank", rel: "noopener noreferrer" } : attribs,
      };
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    iframe: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        loading: "lazy",
        allowfullscreen: "",
        title: attribs.title ?? "Embedded video",
      },
    }),
  },
};

/** Render author-supplied Markdown (which may contain limited HTML) into sanitized HTML. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md ?? "") as string;
  return sanitizeHtml(html, SANITIZE);
}

/** Plain text (discussion replies, comments): escape everything, keep paragraphs/line breaks. */
export function renderPlainText(text: string): string {
  const escaped = sanitizeHtml(text.trim(), { allowedTags: [], allowedAttributes: {} });
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Convert a video page URL (YouTube/Vimeo) into an embeddable player URL, or null. */
export function toEmbedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{6,20}$/.test(v)) return `https://www.youtube-nocookie.com/embed/${v}`;
  }
  if (host === "youtu.be") {
    const v = url.pathname.slice(1);
    if (/^[\w-]{6,20}$/.test(v)) return `https://www.youtube-nocookie.com/embed/${v}`;
  }
  if (host === "vimeo.com") {
    const v = url.pathname.slice(1);
    if (/^\d+$/.test(v)) return `https://player.vimeo.com/video/${v}`;
  }
  return null;
}

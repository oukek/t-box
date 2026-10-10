import { Marked, Renderer } from "marked";
import createDOMPurify, { type WindowLike } from "dompurify";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
function safeUrl(href: string, image = false): string | null {
  try {
    const url = new URL(href);
    if (
      ["http:", "https:"].includes(url.protocol) ||
      (!image && url.protocol === "mailto:")
    )
      return url.href;
  } catch {
    /* Incomplete streaming links remain readable text. */
  }
  return null;
}
const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens),
    url = safeUrl(href);
  if (!url) return text;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>`;
};
renderer.image = ({ href, text, title }) => {
  const url = safeUrl(href, true);
  if (!url) return escapeHtml(text);
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}" loading="lazy" referrerpolicy="no-referrer"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
};
renderer.code = ({ text, lang }) => {
  const language = lang?.trim().split(/\s+/)[0]?.slice(0, 40) || "代码";
  return `<div class="md-code-block"><div class="md-code-toolbar"><span>${escapeHtml(language)}</span><button type="button" class="md-copy-code" aria-label="复制代码">复制</button></div><pre><code>${escapeHtml(text.replace(/\n$/, ""))}\n</code></pre></div>\n`;
};
const renderTable = renderer.table;
renderer.table = function (token) {
  return `<div class="md-table-scroll" tabindex="0" role="region" aria-label="表格">${renderTable.call(this, token)}</div>`;
};
renderer.tablecell = function ({ header, align, tokens }) {
  const tag = header ? "th" : "td";
  return `<${tag}${align ? ` align="${align}"` : ""}>${this.parser.parseInline(tokens)}</${tag}>\n`;
};
const markdown = new Marked({
  renderer,
  gfm: true,
  breaks: true,
  async: false,
});

/** One sanitizer per document; retained Markdown, rather than generated HTML, is the source of truth. */
export function createMarkdownRenderer(
  window: WindowLike,
): (text: string) => string {
  const purifier = createDOMPurify(window);
  return (text) => {
    if (!text) return "";
    try {
      return purifier.sanitize(markdown.parse(text, { async: false }), {
        ALLOWED_TAGS: [
          "p",
          "br",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "strong",
          "em",
          "del",
          "blockquote",
          "ul",
          "ol",
          "li",
          "hr",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "pre",
          "code",
          "a",
          "img",
          "div",
          "span",
          "button",
          "input",
        ],
        ALLOWED_ATTR: [
          "href",
          "target",
          "rel",
          "title",
          "src",
          "alt",
          "loading",
          "referrerpolicy",
          "class",
          "type",
          "disabled",
          "checked",
          "start",
          "align",
          "tabindex",
          "role",
          "aria-label",
        ],
        ALLOW_DATA_ATTR: false,
      });
    } catch {
      // A malformed or incomplete model response must not blank the conversation.
      return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    }
  };
}

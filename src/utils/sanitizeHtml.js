// Sanitizer for the Petty Cash Voucher footer, which is rich text typed in a
// contentEditable box (bold / italic / underline / colour) and later rendered
// as HTML. That HTML can also arrive from an imported backup file, so it is
// never trusted: it is parsed into an inert document (no scripts run, no images
// load) and rebuilt from an allow-list of tags and attributes.

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'SPAN', 'FONT', 'UL', 'OL', 'LI']);
// Removed together with their contents; every other disallowed tag is just unwrapped.
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'LINK', 'META']);

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;
const ALIGN = /^(left|right|center|justify)$/i;
const DECORATION = /^(underline|none|line-through)$/i;
const WEIGHT = /^(bold|normal|[1-9]00)$/i;
const FONT_STYLE = /^(italic|normal)$/i;

const STYLE_RULES = {
  color: COLOR,
  'text-align': ALIGN,
  'text-decoration': DECORATION,
  'font-weight': WEIGHT,
  'font-style': FONT_STYLE,
};

function cleanStyle(value) {
  return value
    .split(';')
    .map(decl => decl.split(':').map(part => part.trim()))
    .filter(([prop, val]) => prop && val && STYLE_RULES[prop.toLowerCase()]?.test(val))
    .map(([prop, val]) => `${prop.toLowerCase()}: ${val}`)
    .join('; ');
}

function cleanNode(node, doc) {
  const out = doc.createDocumentFragment();
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) { // text
      out.appendChild(doc.createTextNode(child.nodeValue));
    } else if (child.nodeType === 1) { // element
      const tag = child.tagName.toUpperCase();
      if (DROP_WITH_CONTENT.has(tag)) continue;
      const inner = cleanNode(child, doc);
      if (!ALLOWED_TAGS.has(tag)) { out.appendChild(inner); continue; }

      const el = doc.createElement(tag.toLowerCase());
      const style = child.getAttribute('style');
      if (style) {
        const cleaned = cleanStyle(style);
        if (cleaned) el.setAttribute('style', cleaned);
      }
      const color = child.getAttribute('color');
      if (tag === 'FONT' && color && COLOR.test(color)) el.setAttribute('color', color);
      el.appendChild(inner);
      out.appendChild(el);
    }
  }
  return out;
}

export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const holder = parsed.createElement('div');
  holder.appendChild(cleanNode(parsed.body, parsed));
  return holder.innerHTML;
}

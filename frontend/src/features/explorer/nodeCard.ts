import type { AtlasNode } from './graphModel';
const xml = (s: string) => s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
// Approximate glyph advance in em for a proportional sans-serif (Segoe UI / Arial / DejaVu fallback),
// deliberately on the wide side so an estimated fit never overflows in the widest fallback font.
// Full-width forms (CJK ideographs, kana, Hangul, full-width Latin) render about 1em wide.
const FULL_WIDTH = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;
const advance = (c: string) => FULL_WIDTH.test(c) ? 1 : /[iljI.,:;'|!()[\] ]/.test(c) ? .32 : /[tfr]/.test(c) ? .4 : /[mwMW@]/.test(c) ? .9 : /\p{Lu}/u.test(c) ? .7 : .58;
const measure = (t: string, fontSize: number) => [...t].reduce((sum, ch) => sum + advance(ch) * fontSize, 0);
/** Truncates with an ellipsis so the estimated rendered width stays within `maxWidth` pixels. */
export function fitText(s: string, fontSize: number, maxWidth: number) {
  if (measure(s, fontSize) <= maxWidth) return s;
  let end = s.length;
  while (end > 0 && measure(s.slice(0, end), fontSize) + .7 * fontSize > maxWidth) end--;
  return s.slice(0, end) + '…';
}
/**
 * Wraps an identifier onto at most `maxLines` lines, preferring camelCase and `._$(,` boundaries
 * (`EventNotFound|Exception`), hard-breaking only a single token wider than a line; the last line is
 * ellipsized if the identifier still does not fit.
 */
export function wrapText(s: string, fontSize: number, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let rest = s;
  while (rest && lines.length < maxLines - 1 && measure(rest, fontSize) > maxWidth) {
    let cut = 0;
    // Leading separators (`_name`, `$$value`) are part of the first word, not a place to break.
    const lead = /^[._$(,]*/.exec(rest)![0].length;
    for (let i = lead + 1; i < rest.length; i++) {
      const boundary = (/\p{Lu}/u.test(rest[i]) && /[\p{Ll}\p{Nd}]/u.test(rest[i - 1])) || /[._$(,]/.test(rest[i - 1]);
      if (!boundary) continue;
      if (measure(rest.slice(0, i), fontSize) > maxWidth) break;
      cut = i;
    }
    if (!cut) { cut = 1; while (cut < rest.length && measure(rest.slice(0, cut + 1), fontSize) <= maxWidth) cut++; }
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) lines.push(fitText(rest, fontSize, maxWidth));
  return lines;
}
/** True for card kinds that own a source range and therefore get a quick-code button on the map. */
export const hasCodeButton = (node: AtlasNode) => node.kind !== 'PACKAGE';
/**
 * The quick-code button's square in card-local pixels, measured from the card's top-right corner.
 * The SVG keeps this corner free and GraphCanvas positions a real DOM button over it, scaled by the
 * current zoom, so the two stay aligned at every camera.
 */
export const CODE_BUTTON = { right: 12, top: 12, size: 40 };
const NAME_SIZE = 30;
/**
 * Escaped local SVG display data. Repository strings never become DOM or executable markup.
 *
 * Card widths stay close to their original 250/280px on purpose: new pages are placed six cards per
 * row (graphPlacement.ts), so the initial fit zoom scales inversely with card width and the name's
 * on-screen size scales with fontSize/width. Doubling the name font (15 -> 30) at the same width
 * doubles what the user actually sees; long names wrap onto a second line instead of widening the card.
 */
export function nodeCard(node: AtlasNode) {
  const pkg=node.kind==='PACKAGE', method=node.kind==='METHOD'||node.kind==='CONSTRUCTOR';
  const width=pkg?280:250,height=pkg?250:method?184:206;
  const ready=['CLASS','METHOD'].includes(node.kind) && node.explanationStatus==='READY';
  // Top row: kind icon, subtitle, then (right-aligned) the sparkle and the quick-code button area.
  const codeLeft=hasCodeButton(node)?width-CODE_BUTTON.right-CODE_BUTTON.size:width-12;
  const sparkleX=codeLeft-36;
  const sparkle=ready?`<defs><linearGradient id="sparkle" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#9461ef"/><stop offset=".6" stop-color="#4b8af2"/><stop offset="1" stop-color="#80ddff"/></linearGradient></defs><g transform="translate(${sparkleX} 16) scale(1.2)"><circle cx="12" cy="12" r="14" fill="#9461ef" opacity=".07"/><circle cx="12" cy="12" r="11" fill="#4b8af2" opacity=".08"/><path fill="url(#sparkle)" d="M12 1C13.4 8.1 15.9 10.6 23 12C15.9 13.4 13.4 15.9 12 23C10.6 15.9 8.1 13.4 1 12C8.1 10.6 10.6 8.1 12 1Z"/></g>`:'';
  const name=pkg?node.simpleName.split('.').pop()!:node.simpleName;
  const role=node.roles?.[0]?.toLowerCase().replaceAll('_',' ') || node.kind.toLowerCase();
  const color=pkg?'#426fa3':node.roles?.includes('SERVICE')?'#16888a':node.roles?.includes('REPOSITORY')?'#596cba':'#398bb3';
  const subtitle=pkg?`${node.memberCount||0} types`:role;
  const inner=width-32;
  const nameLines=wrapText(name,NAME_SIZE,inner,2);
  const nameY=nameLines.length===1?109:92;
  const nameSvg=`<text font-size="${NAME_SIZE}" font-weight="600" fill="#19334f">${nameLines.map((line,i)=>`<tspan x="16" y="${nameY+i*34}">${xml(line)}</tspan>`).join('')}</text>`;
  const members=(node.memberNames||[]).slice(0,2);
  const lower=pkg?`<text x="16" y="156" font-size="13" fill="#7c8ea3">${xml(fitText(node.qualifiedName||node.simpleName,13,inner))}</text>`+members.map((n,i)=>`<rect x="16" y="${170+i*36}" width="${inner}" height="28" rx="5" fill="#edf3f8"/><text x="26" y="${189+i*36}" font-size="14" fill="#4c647f">${xml(fitText(n,14,inner-20))}</text>`).join(''):
    `<line x1="16" y1="142" x2="${width-16}" y2="142" stroke="#e5edf3"/><text x="16" y="166" font-size="14" fill="#74859a">${xml(fitText(node.packageName?.split('.').slice(-2).join('.')||node.qualifiedName||'',14,inner))}</text>${!method?`<text x="16" y="190" font-size="15" fill="#48637c">${node.memberCount||0} methods</text>`:''}`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Segoe UI, Arial, sans-serif"><g transform="translate(16 16) scale(1.2)"><rect width="30" height="30" rx="7" fill="${color}14"/><g stroke="${color}" stroke-width="1.5" fill="none"><path d="M8 7l7-4 7 4v9l-7 4-7-4zM8 7l7 4 7-4M15 11v9"/></g></g><text x="62" y="40" font-size="15" fill="#6c8097">${xml(fitText(subtitle,15,(ready?sparkleX:codeLeft)-62-8))}</text>${nameSvg}${lower}${sparkle}</g></svg>`;
  return { image: 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg), width,height };
}

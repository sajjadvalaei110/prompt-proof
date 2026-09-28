import type { AtlasNode } from './graphModel';
import { REVIEW_CHANGE_PALETTE } from '../review/reviewPalette';
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
 * True for cards that can expand in place into a container of their children: a package into its
 * types, a type into its methods, when it has any (graphModel's `detailCount`, so a class whose only
 * members are nested types shows no button). Mirrors graphModel.isExpandable, kept inline so this module stays
 * free of runtime imports (scripts/test-node-card.mjs loads it on its own).
 */
export const hasDetailsButton = (node: AtlasNode) => !['METHOD', 'FIELD', 'CONSTRUCTOR'].includes(node.kind) && (node.detailCount || 0) > 0;
/**
 * The quick-code button's square in card-local pixels, measured from the card's top-right corner.
 * The SVG keeps this corner free and GraphCanvas positions a real DOM button over it, scaled by the
 * current zoom, so the two stay aligned at every camera.
 */
export const CODE_BUTTON = { right: 12, top: 12, size: 40 };
export type CornerAction = 'code' | 'details';
/**
 * Every on-card corner button, right to left, in the same card-local terms as CODE_BUTTON: the
 * quick-code square keeps its corner, and the details (expand) square sits just to its left.
 */
export function cornerButtons(node: AtlasNode): { action: CornerAction; right: number; top: number; size: number }[] {
  const out: { action: CornerAction; right: number; top: number; size: number }[] = [];
  let right = CODE_BUTTON.right;
  if (hasCodeButton(node)) { out.push({ action: 'code', right, top: CODE_BUTTON.top, size: CODE_BUTTON.size }); right += CODE_BUTTON.size + 8; }
  if (hasDetailsButton(node)) out.push({ action: 'details', right, top: CODE_BUTTON.top, size: CODE_BUTTON.size });
  return out;
}
/** The kind glyph in a card's (and a tree row's) top-left badge: a folder for packages, otherwise
 * an IntelliJ-style letter. The badge tint stays the role colour, so the letter alone carries the kind. */
const KIND_LETTERS: Record<string, string> = { CLASS: 'C', INTERFACE: 'I', ENUM: 'E', RECORD: 'R', ANNOTATION: '@', METHOD: 'm', CONSTRUCTOR: 'c', FIELD: 'f' };
export function kindIcon(kind: string): { folder: true } | { folder: false; letter: string } {
  if (kind === 'PACKAGE') return { folder: true };
  return { folder: false, letter: KIND_LETTERS[kind] ?? 'C' };
}
/** The same folder outline the scope tree draws, in the 16-unit box it was drawn for. */
export const FOLDER_PATH = 'M1.8 4.3c0-.72.58-1.3 1.3-1.3h2.85l1.2 1.4h5.75c.72 0 1.3.58 1.3 1.3v5.7c0 .72-.58 1.3-1.3 1.3H3.1c-.72 0-1.3-.58-1.3-1.3V4.3z';

export interface CardSize { width: number; height: number }
/** The card's size when the user has not resized it. */
export function defaultCardSize(node: AtlasNode): CardSize {
  const pkg=node.kind==='PACKAGE', method=node.kind==='METHOD'||node.kind==='CONSTRUCTOR';
  return { width: pkg?280:250, height: pkg?250:method?184:206 };
}
/** The smallest a user may resize a card to: room for the corner buttons and the name. */
export const MIN_CARD_SIZE: CardSize = { width: 180, height: 130 };
const NAME_SIZE = 30;
/**
 * Escaped local SVG display data. Repository strings never become DOM or executable markup.
 *
 * Card widths stay close to their original 250/280px on purpose: new pages are placed six cards per
 * row (graphPlacement.ts), so the initial fit zoom scales inversely with card width and the name's
 * on-screen size scales with fontSize/width. Doubling the name font (15 -> 30) at the same width
 * doubles what the user actually sees; long names wrap onto a second line instead of widening the card.
 *
 * `size` is a user resize. Content keeps its top-anchored layout: a wider card fits more of each
 * line, a taller one shows more member rows, and a shorter one drops lower lines that no longer
 * fit. At the default size the output is unchanged.
 */
export function nodeCard(node: AtlasNode, size?: CardSize) {
  const pkg=node.kind==='PACKAGE', method=node.kind==='METHOD'||node.kind==='CONSTRUCTOR';
  const {width,height}=size||defaultCardSize(node);
  const ready=['CLASS','METHOD'].includes(node.kind) && node.explanationStatus==='READY';
  // Review state is deliberately rendered into the card image rather than as a Cytoscape label:
  // the badge stays attached to a card while it is dragged, resized or nested in a compound box.
  // Fit the complete change string to the available card width so large line counts never run out
  // of the rounded badge. Base/head graphs omit reviewChange and therefore retain the ordinary card.
  const reviewChange=node.reviewChange&&node.reviewChange!=='UNCHANGED' ? node.reviewChange : null;
  // UNKNOWN: the declaration's file did not parse on one side, so a line delta would be meaningless.
  const unknown=reviewChange==='UNKNOWN';
  const reviewText=reviewChange==='ADDED'?'ADDED':reviewChange==='REMOVED'?'REMOVED':'CHANGED';
  const reviewLabel=unknown?'NOT ANALYZED':`${reviewText} +${node.reviewAddedLines||0} −${node.reviewRemovedLines||0}`;
  const reviewWidth=Math.min(Math.max(112,reviewLabel.length*6.2+27),Math.max(112,width-24));
  // Scale the label before falling back to an ellipsis: line totals remain readable together even
  // when a package contains many changed declarations.
  const reviewFont=Math.max(7,Math.min(11,(reviewWidth-18)/(reviewLabel.length*.58)));
  const badgeTone=unknown?REVIEW_CHANGE_PALETTE.UNKNOWN:reviewChange==='ADDED'?REVIEW_CHANGE_PALETTE.ADDED:reviewChange==='REMOVED'?REVIEW_CHANGE_PALETTE.REMOVED:REVIEW_CHANGE_PALETTE.MODIFIED;
  const review=reviewChange
    ? `<g transform="translate(12 55)"><rect width="${reviewWidth}" height="24" rx="12" fill="${badgeTone.badgeFill}" stroke="${badgeTone.border}"${unknown?' stroke-dasharray="4 3"':''}/><text x="10" y="16" font-size="${reviewFont}" font-weight="600" fill="${badgeTone.text}">${xml(fitText(reviewLabel,reviewFont,reviewWidth-18))}</text></g>` : '';
  // Top row: kind icon, subtitle, then (right-aligned) the sparkle and the corner button area.
  const corners=cornerButtons(node);
  const codeLeft=corners.length?width-Math.max(...corners.map(c=>c.right+c.size)):width-12;
  const sparkleX=codeLeft-36;
  const sparkle=ready?`<defs><linearGradient id="sparkle" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#9461ef"/><stop offset=".6" stop-color="#4b8af2"/><stop offset="1" stop-color="#80ddff"/></linearGradient></defs><g transform="translate(${sparkleX} 16) scale(1.2)"><circle cx="12" cy="12" r="14" fill="#9461ef" opacity=".07"/><circle cx="12" cy="12" r="11" fill="#4b8af2" opacity=".08"/><path fill="url(#sparkle)" d="M12 1C13.4 8.1 15.9 10.6 23 12C15.9 13.4 13.4 15.9 12 23C10.6 15.9 8.1 13.4 1 12C8.1 10.6 10.6 8.1 12 1Z"/></g>`:'';
  const name=pkg?node.simpleName.split('.').pop()!:node.simpleName;
  const role=node.roles?.[0]?.toLowerCase().replaceAll('_',' ') || node.kind.toLowerCase();
  const color=pkg?'#426fa3':node.roles?.includes('SERVICE')?'#16888a':node.roles?.includes('REPOSITORY')?'#596cba':'#398bb3';
  const icon=kindIcon(node.kind);
  const kindGlyph=icon.folder
    ?`<path transform="translate(5 5) scale(1.25)" d="${FOLDER_PATH}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round" fill="none"/>`
    :`<text x="15" y="20.5" text-anchor="middle" font-size="16" font-weight="700" fill="${color}">${xml(icon.letter)}</text>`;
  const subtitle=pkg?`${node.memberCount||0} types`:role;
  const inner=width-32;
  const nameLines=wrapText(name,NAME_SIZE,inner,2);
  // The review badge occupies the upper-left band. Keep the title below it and move the lower
  // metadata/divider down by the same amount so a two-line reviewed name never collides with either.
  const reviewOffset=reviewChange?36:0;
  const nameY=reviewChange?112:nameLines.length===1?109:92;
  const nameSvg=`<text font-size="${NAME_SIZE}" font-weight="600" fill="#19334f">${nameLines.map((line,i)=>`<tspan x="16" y="${nameY+i*34}">${xml(line)}</tspan>`).join('')}</text>`;
  // A text line fits while its baseline leaves room for descenders above the bottom border.
  const fits=(baseline:number)=>baseline+8<=height;
  const rows=[] as string[];
  const rowStart=170+reviewOffset;
  for(const n of node.memberNames||[]){const y=rowStart+rows.length*36;if(y+28+8>height)break;rows.push(n);}
  // Where the card lives: a method names its class first (ADR 0011), so one freed from an ungrouped
  // class still says where it belongs; fitText cuts from the end, so the class name survives.
  const pkgTail=node.packageName?.split('.').slice(-2).join('.')||'';
  const placeLine=method&&node.ownerName?[node.ownerName,pkgTail].filter(Boolean).join(' · '):pkgTail||node.qualifiedName||'';
  const lower=pkg?(fits(156+reviewOffset)?`<text x="16" y="${156+reviewOffset}" font-size="13" fill="#7c8ea3">${xml(fitText(node.qualifiedName||node.simpleName,13,inner))}</text>`:'')+rows.map((n,i)=>`<rect x="16" y="${rowStart+i*36}" width="${inner}" height="28" rx="5" fill="#edf3f8"/><text x="26" y="${189+reviewOffset+i*36}" font-size="14" fill="#4c647f">${xml(fitText(n,14,inner-20))}</text>`).join(''):
    (fits(142+reviewOffset)?`<line x1="16" y1="${142+reviewOffset}" x2="${width-16}" y2="${142+reviewOffset}" stroke="#e5edf3"/>`:'')+(fits(166+reviewOffset)?`<text x="16" y="${166+reviewOffset}" font-size="14" fill="#74859a">${xml(fitText(placeLine,14,inner))}</text>`:'')+(!method&&fits(190+reviewOffset)?`<text x="16" y="${190+reviewOffset}" font-size="15" fill="#48637c">${node.memberCount||0} methods</text>`:'');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Segoe UI, Arial, sans-serif"><g transform="translate(16 16) scale(1.2)"><rect width="30" height="30" rx="7" fill="${color}14"/>${kindGlyph}</g><text x="62" y="40" font-size="15" fill="#6c8097">${xml(fitText(subtitle,15,(ready?sparkleX:codeLeft)-62-8))}</text>${review}${nameSvg}${lower}${sparkle}</g></svg>`;
  return { image: 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg), width,height };
}

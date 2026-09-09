import type { AtlasNode } from './graphModel';
const xml = (s: string) => s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const cut = (s: string, length: number) => s.length>length?s.slice(0,length-1)+'…':s;
/** Escaped local SVG display data. Repository strings never become DOM or executable markup. */
export function nodeCard(node: AtlasNode) {
  const pkg=node.kind==='PACKAGE', method=node.kind==='METHOD';
  const width=pkg?280:250,height=pkg?148:method?104:128;
  const ready=['CLASS','METHOD'].includes(node.kind) && node.explanationStatus==='READY';
  const sparkle=ready?`<defs><linearGradient id="sparkle" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#9461ef"/><stop offset=".6" stop-color="#4b8af2"/><stop offset="1" stop-color="#80ddff"/></linearGradient></defs><g transform="translate(216 13)"><circle cx="12" cy="12" r="14" fill="#9461ef" opacity=".07"/><circle cx="12" cy="12" r="11" fill="#4b8af2" opacity=".08"/><path fill="url(#sparkle)" d="M12 1C13.4 8.1 15.9 10.6 23 12C15.9 13.4 13.4 15.9 12 23C10.6 15.9 8.1 13.4 1 12C8.1 10.6 10.6 8.1 12 1Z"/></g>`:'';
  const name=pkg?node.simpleName.split('.').pop()!:node.simpleName;
  const role=node.roles?.[0]?.toLowerCase().replaceAll('_',' ') || node.kind.toLowerCase();
  const color=pkg?'#426fa3':node.roles?.includes('SERVICE')?'#16888a':node.roles?.includes('REPOSITORY')?'#596cba':'#398bb3';
  const subtitle=pkg?`${node.memberCount||0} types`:role;
  const members=(node.memberNames||[]).slice(0,2);
  const lower=pkg?members.map((n,i)=>`<rect x="18" y="${88+i*23}" width="244" height="20" rx="4" fill="#edf3f8"/><text x="26" y="${102+i*23}" font-size="10" fill="#4c647f">${xml(cut(n,34))}</text>`).join(''):
    `<line x1="16" y1="75" x2="234" y2="75" stroke="#e5edf3"/><text x="18" y="94" font-size="10" fill="#74859a">${xml(cut(node.packageName?.split('.').slice(-2).join('.')||node.qualifiedName||'',35))}</text>${!method?`<text x="18" y="114" font-size="11" fill="#48637c">${node.memberCount||0} methods</text>`:''}`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Segoe UI, Arial, sans-serif"><rect x="16" y="18" width="30" height="30" rx="7" fill="${color}14"/><g stroke="${color}" stroke-width="1.5" fill="none"><path d="M24 25l7-4 7 4v9l-7 4-7-4zM24 25l7 4 7-4M31 29v9"/></g><text x="55" y="31" font-size="15" font-weight="600" fill="#19334f">${xml(cut(name,pkg?25:ready?17:22))}</text><text x="55" y="50" font-size="11" fill="#6c8097">${xml(subtitle)}</text>${pkg?`<text x="18" y="73" font-size="10" fill="#7c8ea3">${xml(cut(node.qualifiedName||node.simpleName,44))}</text>`:''}${lower}${sparkle}</g></svg>`;
  return { image: 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg), width,height };
}

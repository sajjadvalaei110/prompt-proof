import type { AtlasNode } from './graphModel';
const xml = (s: string) => s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const cut = (s: string, length: number) => s.length>length?s.slice(0,length-1)+'…':s;
/** Escaped local SVG display data. Repository strings never become DOM or executable markup. */
export function nodeCard(node: AtlasNode) {
  const pkg=node.kind==='PACKAGE', method=node.kind==='METHOD';
  const width=pkg?280:250,height=pkg?148:method?104:128;
  const name=pkg?node.simpleName.split('.').pop()!:node.simpleName;
  const role=node.roles?.[0]?.toLowerCase().replaceAll('_',' ') || node.kind.toLowerCase();
  const color=pkg?'#426fa3':node.roles?.includes('SERVICE')?'#16888a':node.roles?.includes('REPOSITORY')?'#596cba':'#398bb3';
  const subtitle=pkg?`${node.memberCount||0} types`:role;
  const members=(node.memberNames||[]).slice(0,2);
  const lower=pkg?members.map((n,i)=>`<rect x="18" y="${88+i*23}" width="244" height="20" rx="4" fill="#edf3f8"/><text x="26" y="${102+i*23}" font-size="10" fill="#4c647f">${xml(cut(n,34))}</text>`).join(''):
    `<line x1="16" y1="75" x2="234" y2="75" stroke="#e5edf3"/><text x="18" y="94" font-size="10" fill="#74859a">${xml(cut(node.packageName?.split('.').slice(-2).join('.')||node.qualifiedName||'',35))}</text>${!method?`<text x="18" y="114" font-size="11" fill="#48637c">${node.memberCount||0} methods</text>`:''}`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Segoe UI, Arial, sans-serif"><rect x="16" y="18" width="30" height="30" rx="7" fill="${color}14"/><g stroke="${color}" stroke-width="1.5" fill="none"><path d="M24 25l7-4 7 4v9l-7 4-7-4zM24 25l7 4 7-4M31 29v9"/></g><text x="55" y="31" font-size="15" font-weight="600" fill="#19334f">${xml(cut(name,pkg?25:22))}</text><text x="55" y="50" font-size="11" fill="#6c8097">${xml(subtitle)}</text>${pkg?`<text x="18" y="73" font-size="10" fill="#7c8ea3">${xml(cut(node.qualifiedName||node.simpleName,44))}</text>`:''}${lower}</g></svg>`;
  return { image: 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg), width,height };
}

import type { AtlasNode, AtlasEdge } from './graphModel';
/** Stable two-dimensional layout. Pan/zoom never changes node positions. */
export function graphLayout(nodes: AtlasNode[], edges: AtlasEdge[], focus?: string) {
  const positions: Record<string,{x:number;y:number}> = {};
  const sorted=[...nodes].sort((a,b)=>a.simpleName.localeCompare(b.simpleName));
  const focused=nodes.find(n=>n.id===focus);
  const dx=focused?.kind==='PACKAGE'?345:310, dy=focused?.kind==='METHOD'?142:166;
  if(focused){
    const incoming=new Set(edges.filter(e=>e.targetId===focus).map(e=>e.sourceId));
    const outgoing=new Set(edges.filter(e=>e.sourceId===focus).map(e=>e.targetId));
    const left=sorted.filter(n=>n.id!==focus&&incoming.has(n.id));
    const right=sorted.filter(n=>n.id!==focus&&!incoming.has(n.id)&&outgoing.has(n.id));
    const other=sorted.filter(n=>n.id!==focus&&!incoming.has(n.id)&&!outgoing.has(n.id));
    positions[focus!]={x:dx,y:Math.max(left.length,right.length,1)*dy/2};
    left.forEach((n,i)=>positions[n.id]={x:0,y:positions[focus!].y+(i-(left.length-1)/2)*dy});
    right.forEach((n,i)=>positions[n.id]={x:dx*2,y:positions[focus!].y+(i-(right.length-1)/2)*dy});
    other.forEach((n,i)=>positions[n.id]={x:(i%3)*dx,y:(Math.max(left.length,right.length,1)+1)*dy+Math.floor(i/3)*dy});
  }else{
    const columns=Math.max(1,Math.ceil(Math.sqrt(nodes.length*1.2)));
    sorted.forEach((n,i)=>positions[n.id]={x:(i%columns)*(n.kind==='PACKAGE'?340:310),y:Math.floor(i/columns)*(n.kind==='PACKAGE'?220:180)});
  }
  return positions;
}

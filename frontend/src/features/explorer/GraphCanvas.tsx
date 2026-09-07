import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
// @ts-ignore
import navigator from 'cytoscape-navigator';
import 'cytoscape-navigator/cytoscape.js-navigator.css';

cytoscape.use(dagre);
cytoscape.use(navigator);

interface GraphCanvasProps {
  nodes: any[];
  edges: any[];
}

export default function GraphCanvas({ nodes, edges }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    if (!containerRef.current) return;
    
    const cyNodes = nodes.map(n => {
      const data: any = { id: n.id, label: n.simpleName, kind: n.kind };
      if (n.parentId) {
        data.parent = n.parentId;
      }
      return { data };
    });
    const cyEdges = edges.map(e => ({
      data: { id: e.id, source: e.sourceId, target: e.targetId, label: e.kind }
    }));

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...cyNodes, ...cyEdges],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#4A9B8E',
            'label': 'data(label)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            'width': 'label',
            'height': 'label',
            'padding': '10px',
            'shape': 'round-rectangle'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#9dbaea',
            'target-arrow-color': '#9dbaea',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '8px',
            'text-rotation': 'autorotate',
            'text-margin-y': -10 as any
          }
        }
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 50,
        rankSep: 100
      } as any
    });
    
    // Add minimap
    (cy as any).navigator({
      container: false // Let it append to the container automatically
    });
    
    cyRef.current = cy;
    
    // Zoom to selection event handler
    cy.on('select', 'node', (evt) => {
        const node = evt.target;
        cy.animate({
            fit: {
                eles: node,
                padding: 50
            },
            duration: 500
        } as any);
    });

    return () => {
      cy.destroy();
    };
  }, [nodes, edges]);

  // Filtering
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    
    cy.batch(() => {
        cy.nodes().forEach(node => {
            const kind = node.data('kind');
            const label = (node.data('label') || '').toLowerCase();
            const kindMatch = filterType === 'ALL' || kind === filterType;
            const searchMatch = search === '' || label.includes(search.toLowerCase());
            
            if (kindMatch && searchMatch) {
                node.style('display', 'element');
            } else {
                node.style('display', 'none');
            }
        });
    });
  }, [filterType, search]);

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px', background: '#f0f0f0', display: 'flex', gap: '10px' }}>
        <input 
            type="text" 
            placeholder="Search selection..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="ALL">All Types</option>
            <option value="CLASS">Class</option>
            <option value="INTERFACE">Interface</option>
            <option value="METHOD">Method</option>
            <option value="PACKAGE">Package</option>
        </select>
      </div>
      <div ref={containerRef} style={{ flex: 1, width: '100%' }} />
    </div>
  );
}

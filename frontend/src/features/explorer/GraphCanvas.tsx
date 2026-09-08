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
  onNodeSelect?: (nodeData: any) => void;
  onEdgeSelect?: (edgeData: any) => void;
}

/**
 * Cytoscape graph canvas with Spring-aware visual styling.
 *
 * R3 enhancements:
 * - Spring stereotypes shown with distinct colors and border styles
 * - REST_CONTROLLER nodes have green color with API icon indicator
 * - SERVICE nodes in teal, REPOSITORY in orange, CONFIGURATION in purple
 * - INJECTS edges shown as dashed magenta lines
 * - DECLARES_BEAN edges shown as dotted purple lines
 * - Filter dropdown includes Spring role filters
 */
export default function GraphCanvas({ nodes, edges, onNodeSelect, onEdgeSelect }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    if (!containerRef.current) return;

    const cyNodes = nodes.map(n => {
      const data: any = {
        id: n.id,
        label: n.simpleName,
        kind: n.kind,
        qualifiedName: n.qualifiedName,
        roles: n.roles || [],
        responsibilitySummary: n.responsibilitySummary || '',
        explanationStatus: n.explanationStatus || 'NOT_REQUESTED',
        // Compute primary Spring role for styling
        springRole: (n.roles && n.roles.length > 0) ? n.roles[0] : 'NONE',
      };
      if (n.parentId) {
        data.parent = n.parentId;
      }
      return { data };
    });

    const cyEdges = edges.map(e => ({
      data: {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        kind: e.kind,
        resolution: e.resolution,
        label: e.descriptiveLabel || e.kind,
        hoverSummary: e.hoverSummary || '',
      }
    }));

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...cyNodes, ...cyEdges],
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 4.0,
      style: [
        // --- Package nodes (compound containers) ---
        {
          selector: 'node[kind = "PACKAGE"]',
          style: {
            'background-color': '#2d2d44',
            'border-color': '#756bb1',
            'border-width': 2,
            'shape': 'round-rectangle',
            'label': 'data(label)',
            'color': '#b0b0cc',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': '11px',
            'padding': '15px',
          }
        },
        // --- Default CLASS/INTERFACE nodes ---
        {
          selector: 'node[kind = "CLASS"], node[kind = "INTERFACE"]',
          style: {
            'background-color': '#3182bd',
            'border-color': '#5a9bd5',
            'border-width': 2,
            'shape': 'round-rectangle',
            'label': 'data(label)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            'width': 'label',
            'height': 'label',
            'padding': '10px',
          }
        },
        // --- Spring REST_CONTROLLER nodes (green) ---
        {
          selector: 'node[springRole = "REST_CONTROLLER"]',
          style: {
            'background-color': '#2e7d32',
            'border-color': '#66bb6a',
            'border-width': 3,
            'shape': 'round-rectangle',
          }
        },
        // --- Spring CONTROLLER nodes (green, lighter) ---
        {
          selector: 'node[springRole = "CONTROLLER"]',
          style: {
            'background-color': '#388e3c',
            'border-color': '#81c784',
            'border-width': 3,
          }
        },
        // --- Spring SERVICE nodes (teal) ---
        {
          selector: 'node[springRole = "SERVICE"]',
          style: {
            'background-color': '#00796b',
            'border-color': '#4db6ac',
            'border-width': 3,
          }
        },
        // --- Spring REPOSITORY nodes (orange) ---
        {
          selector: 'node[springRole = "REPOSITORY"]',
          style: {
            'background-color': '#e65100',
            'border-color': '#ff9800',
            'border-width': 3,
          }
        },
        // --- Spring CONFIGURATION nodes (deep purple) ---
        {
          selector: 'node[springRole = "CONFIGURATION"]',
          style: {
            'background-color': '#4527a0',
            'border-color': '#b39ddb',
            'border-width': 3,
          }
        },
        // --- Spring COMPONENT nodes (cyan) ---
        {
          selector: 'node[springRole = "COMPONENT"]',
          style: {
            'background-color': '#0277bd',
            'border-color': '#4fc3f7',
            'border-width': 3,
          }
        },
        // --- INTERFACE nodes (diamond shape) ---
        {
          selector: 'node[kind = "INTERFACE"]',
          style: {
            'shape': 'diamond',
          }
        },
        // --- METHOD nodes ---
        {
          selector: 'node[kind = "METHOD"]',
          style: {
            'background-color': '#31a354',
            'shape': 'ellipse',
            'label': 'data(label)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '8px',
            'width': 'label',
            'height': 'label',
            'padding': '5px',
          }
        },
        // --- Nodes with STALE explanation ---
        {
          selector: 'node[explanationStatus = "STALE"]',
          style: {
            'border-style': 'dashed',
          }
        },
        // --- Selected node ---
        {
          selector: 'node:selected',
          style: {
            'border-color': '#ffeb3b',
            'border-width': 4,
          }
        },
        // --- Default edges ---
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#78909c',
            'target-arrow-color': '#78909c',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.7,
          }
        },
        // --- EXTENDS edges (red) ---
        {
          selector: 'edge[kind = "EXTENDS"]',
          style: {
            'line-color': '#e53935',
            'target-arrow-color': '#e53935',
            'target-arrow-shape': 'triangle',
            'width': 2.5,
            'opacity': 0.9,
          }
        },
        // --- IMPLEMENTS edges (purple dashed) ---
        {
          selector: 'edge[kind = "IMPLEMENTS"]',
          style: {
            'line-color': '#8e24aa',
            'target-arrow-color': '#8e24aa',
            'target-arrow-shape': 'triangle',
            'line-style': 'dashed',
            'width': 2.5,
            'opacity': 0.9,
          }
        },
        // --- CALLS edges (subtle blue) ---
        {
          selector: 'edge[kind = "CALLS"]',
          style: {
            'line-color': '#546e7a',
            'target-arrow-color': '#546e7a',
            'target-arrow-shape': 'vee',
            'width': 1.5,
            'opacity': 0.5,
          }
        },
        // --- DEPENDS_ON edges (very subtle) ---
        {
          selector: 'edge[kind = "DEPENDS_ON"]',
          style: {
            'line-color': '#455a64',
            'target-arrow-color': '#455a64',
            'target-arrow-shape': 'vee',
            'width': 1,
            'opacity': 0.3,
          }
        },
        // --- INJECTS edges (Spring DI — magenta dashed) ---
        {
          selector: 'edge[kind = "INJECTS"]',
          style: {
            'line-color': '#e91e63',
            'target-arrow-color': '#e91e63',
            'target-arrow-shape': 'diamond',
            'line-style': 'dashed',
            'width': 2.5,
            'opacity': 0.85,
          }
        },
        // --- DECLARES_BEAN edges (Spring factory — purple dotted) ---
        {
          selector: 'edge[kind = "DECLARES_BEAN"]',
          style: {
            'line-color': '#7b1fa2',
            'target-arrow-color': '#7b1fa2',
            'target-arrow-shape': 'circle',
            'line-style': 'dotted',
            'width': 2,
            'opacity': 0.8,
          }
        },
        // --- UNRESOLVED edges ---
        {
          selector: 'edge[resolution = "UNRESOLVED"]',
          style: {
            'line-style': 'dotted',
            'opacity': 0.25,
          }
        },
        // --- CANDIDATE edges ---
        {
          selector: 'edge[resolution = "CANDIDATE"]',
          style: {
            'line-style': 'dashed',
            'opacity': 0.5,
          }
        },
        // --- Selected edge ---
        {
          selector: 'edge:selected',
          style: {
            'width': 4,
            'opacity': 1,
            'line-color': '#ffeb3b',
            'target-arrow-color': '#ffeb3b',
          }
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 50,
        rankSep: 100,
      } as any,
    });

    // Add minimap
    try {
      (cy as any).navigator({ container: false });
    } catch (e) {
      // Navigator plugin may not be available
    }

    cyRef.current = cy;

    // Node click handler (200ms duration for responsive focus)
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (onNodeSelect) {
        onNodeSelect(node.data());
      }
      cy.animate({
        fit: { eles: node.neighborhood().add(node), padding: 50 },
        duration: 200,
      } as any);
    });

    // Edge click handler
    cy.on('tap', 'edge', (evt) => {
      if (onEdgeSelect) {
        onEdgeSelect(evt.target.data());
      }
    });

    return () => {
      cy.destroy();
    };
  }, [nodes, edges]);

  // Zoom control handlers
  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * 1.3,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() / 1.3,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };

  const handleFit = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(undefined, 40);
  };

  const handleReset = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom(1);
    cy.center();
  };

  // Compound-aware filtering
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    const searchLower = search.trim().toLowerCase();
    const visibleNodeIds = new Set<string>();

    // 1. Determine visibility for target nodes
    cy.nodes().forEach(node => {
      const kind = node.data('kind');
      const springRole = node.data('springRole') || 'NONE';
      const roles: string[] = node.data('roles') || [];
      const label = (node.data('label') || '').toLowerCase();
      const qName = (node.data('qualifiedName') || '').toLowerCase();

      const searchMatch = !searchLower || label.includes(searchLower) || qName.includes(searchLower);

      let typeMatch = false;
      switch (filterType) {
        case 'ALL':
          typeMatch = true;
          break;
        case 'SPRING':
          typeMatch = springRole !== 'NONE' || roles.length > 0;
          break;
        case 'REST_CONTROLLER':
        case 'SERVICE':
        case 'REPOSITORY':
        case 'COMPONENT':
        case 'CONFIGURATION':
          typeMatch = springRole === filterType || roles.includes(filterType);
          break;
        case 'CLASS':
          typeMatch = kind === 'CLASS';
          break;
        case 'INTERFACE':
          typeMatch = kind === 'INTERFACE';
          break;
        case 'METHOD':
          typeMatch = kind === 'METHOD';
          break;
        case 'PACKAGE':
          typeMatch = kind === 'PACKAGE';
          break;
        default:
          typeMatch = kind === filterType;
          break;
      }

      if (typeMatch && searchMatch) {
        visibleNodeIds.add(node.id());
        // If searching and a container (like a package in ALL/PACKAGE mode) matches search,
        // also keep its child elements visible so the user can inspect it
        if (searchLower && (filterType === 'ALL' || filterType === 'PACKAGE')) {
          node.descendants().forEach(d => {
            visibleNodeIds.add(d.id());
          });
        }
      }
    });

    // 2. Compound node rule: Keep ancestor containers visible!
    // A compound parent (e.g. PACKAGE containing CLASS, or CLASS containing METHOD)
    // MUST have display: 'element' if any of its descendants are visible,
    // otherwise Cytoscape will hide all descendants automatically.
    const directMatches = Array.from(visibleNodeIds);
    for (const id of directMatches) {
      const node = cy.getElementById(id);
      node.ancestors().forEach(ancestor => {
        visibleNodeIds.add(ancestor.id());
      });
    }

    // 3. Batch apply display styles
    cy.batch(() => {
      cy.nodes().forEach(node => {
        const shouldShow = visibleNodeIds.has(node.id());
        node.style('display', shouldShow ? 'element' : 'none');
      });
    });

    // 4. Smoothly fit view to visible nodes
    const visibleElements = cy.nodes(':visible');
    if (visibleElements.length > 0) {
      cy.animate({
        fit: { eles: visibleElements, padding: 40 },
        duration: 300,
      } as any);
    }
  }, [filterType, search]);

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', background: '#1e1e2e', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid #333' }}>
        <input
          type="text"
          placeholder="Search classes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '4px 8px', background: '#2d2d44', border: '1px solid #444', color: '#fff', borderRadius: '4px', flex: 1, maxWidth: '250px' }}
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: '4px 8px', background: '#2d2d44', border: '1px solid #444', color: '#fff', borderRadius: '4px' }}
        >
          <optgroup label="All">
            <option value="ALL">All Types</option>
          </optgroup>
          <optgroup label="Java Types">
            <option value="CLASS">Class</option>
            <option value="INTERFACE">Interface</option>
            <option value="METHOD">Method</option>
            <option value="PACKAGE">Package</option>
          </optgroup>
          <optgroup label="Spring Roles">
            <option value="SPRING">🌱 All Spring</option>
            <option value="REST_CONTROLLER">🌐 REST Controller</option>
            <option value="SERVICE">⚙️ Service</option>
            <option value="REPOSITORY">💾 Repository</option>
            <option value="COMPONENT">📦 Component</option>
            <option value="CONFIGURATION">🔧 Configuration</option>
          </optgroup>
        </select>
        {/* Legend */}
        <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: '#888', marginLeft: 'auto' }}>
          <span><span style={{ color: '#e91e63' }}>━━</span> injects</span>
          <span><span style={{ color: '#e53935' }}>━━</span> extends</span>
          <span><span style={{ color: '#8e24aa' }}>╌╌</span> implements</span>
          <span><span style={{ color: '#7b1fa2' }}>···</span> bean</span>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#1a1a2e' }} />

        {/* Floating Zoom Controls Toolbar */}
        <div
          className="graph-zoom-toolbar"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            background: 'rgba(30, 30, 46, 0.92)',
            padding: '6px',
            borderRadius: '8px',
            border: '1px solid #444',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In (+)"
            aria-label="Zoom In"
            style={{
              width: '32px',
              height: '32px',
              background: '#2d2d44',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            +
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            aria-label="Zoom Out"
            style={{
              width: '32px',
              height: '32px',
              background: '#2d2d44',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            -
          </button>
          <button
            type="button"
            onClick={handleFit}
            title="Fit to View (⛶)"
            aria-label="Fit to View"
            style={{
              width: '32px',
              height: '32px',
              background: '#2d2d44',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ⛶
          </button>
          <button
            type="button"
            onClick={handleReset}
            title="Reset 100% (1:1)"
            aria-label="Reset Zoom"
            style={{
              width: '32px',
              height: '32px',
              background: '#2d2d44',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            1:1
          </button>
        </div>
      </div>
    </div>
  );
}

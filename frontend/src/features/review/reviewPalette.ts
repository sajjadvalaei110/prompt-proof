/** One source of truth for review change colors used by Cytoscape, SVG cards and tests. */
export const REVIEW_CHANGE_PALETTE = {
  ADDED: {
    nodeFill: '#e9f8ef', badgeFill: '#d7f3e3', border: '#168a58', text: '#0f5c3d',
    route: '#168a58', arrow: '#147c4f',
  },
  REMOVED: {
    nodeFill: '#fdecec', badgeFill: '#fbdada', border: '#c74545', text: '#8a2323',
    route: '#c74545', arrow: '#b33e3e',
  },
  MODIFIED: {
    nodeFill: '#fff4c8', badgeFill: '#fff0b0', border: '#ba862d', text: '#805b12',
  },
  UNKNOWN: {
    badgeFill: '#eef2f6', border: '#6b7c90', text: '#4d5d70',
    route: '#ba862d', arrow: '#a77929',
  },
} as const;

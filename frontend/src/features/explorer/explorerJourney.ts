import { explorerViewReducer, initExplorerViewState, ExplorerAction, ExplorerViewState } from './explorerViewState';
import { ScopeSelection } from './scopeModel';

/** UI state only. Graph facts, generated results and server operations never enter history. */
export interface Journey {
  view: ExplorerViewState;
  scope: ScopeSelection;
  kind: string;
  tab: string;
  search: string;
  mobilePane: string;
  source: { node: { id: string; simpleName?: string }; type: string } | null;
  treeOpen: Record<string, boolean>;
  multiIds: string[];
  mapOpen: boolean;
  fullscreen: boolean;
  navWidth: number | null;
}
export interface JourneyTab {
  id: number;
  title: string;
  present: Journey;
  past: Journey[];
  future: Journey[];
  group: number | null;
  restoreVersion: number;
}
export interface ExplorerJourneys {
  tabs: JourneyTab[];
  closed: JourneyTab[];
  activeId: number;
  nextId: number;
  initial: Journey;
}
export const HISTORY_LIMIT = 200;
export function newJourney(view = initExplorerViewState()): Journey {
  return { view, scope: { mode: 'ALL', selectedPackageIds: new Set(), selectedClassIds: new Set() }, kind: 'ALL', tab: 'map', search: '', mobilePane: 'map', source: null, treeOpen: {}, multiIds: [], mapOpen: true, fullscreen: false, navWidth: null };
}
function newTab(id: number, present: Journey): JourneyTab {
  return { id, title: `Explore ${id}`, present, past: [], future: [], group: null, restoreVersion: 0 };
}
export function initJourneys(initial = newJourney()): ExplorerJourneys {
  return { tabs: [newTab(1, initial)], closed: [], activeId: 1, nextId: 2, initial };
}
export type JourneyAction =
  | { type: 'RESET'; view: ExplorerViewState }
  | { type: 'NEW' | 'CLONE' | 'REOPEN' | 'UNDO' | 'REDO' }
  | { type: 'SWITCH' | 'CLOSE'; id: number }
  // `collapse`: used only by the canvas double-click-to-arrange flow. Click 1 (a plain tap on an
  // uninspected node) always seals its own undo step before `dbltap` fires -- a real macrotask gap
  // separates the two physical clicks, so the group-lifecycle mechanism below can never merge them
  // on its own. When the caller has verified this update is the second half of that same gesture
  // (same node, same tab, within the gesture window), it sets `collapse: true` so this update joins
  // the immediately preceding entry instead of opening a new one -- one undo then fully reverts the
  // whole double-click, not just the arrangement.
  | { type: 'UPDATE'; id: number; group: number; collapse?: boolean; update: (j: Journey) => Journey }
  | { type: 'INITIAL_CAMERA'; id: number; action: Extract<ExplorerAction, { type: 'SET_CAMERA' }> };

export function journeysReducer(state: ExplorerJourneys, action: JourneyAction): ExplorerJourneys {
  if (action.type === 'RESET') {
    const initial = newJourney(action.view);
    // Never reuse IDs: callbacks from a destroyed snapshot cannot edit the replacement tab.
    return { tabs: [newTab(state.nextId, initial)], closed: [], activeId: state.nextId, nextId: state.nextId + 1, initial };
  }
  const active = state.tabs.find(t => t.id === state.activeId)!;
  if (action.type === 'NEW' || action.type === 'CLONE') {
    const tab = action.type === 'NEW' ? newTab(state.nextId, state.initial)
      : { ...active, id: state.nextId, title: `Explore ${state.nextId} (copy)`, group: null };
    // Reducers use immutable updates, including scope Sets. Sharing unchanged history is safe.
    return { ...state, tabs: [...state.tabs, tab], activeId: tab.id, nextId: state.nextId + 1 };
  }
  if (action.type === 'SWITCH') return state.tabs.some(t => t.id === action.id) ? { ...state, activeId: action.id } : state;
  if (action.type === 'CLOSE') {
    const index = state.tabs.findIndex(t => t.id === action.id);
    if (index < 0 || state.tabs.length === 1) return state;
    const tabs = state.tabs.filter(t => t.id !== action.id);
    return { ...state, tabs, closed: [...state.closed, state.tabs[index]].slice(-10), activeId: state.activeId === action.id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId };
  }
  if (action.type === 'REOPEN') {
    const tab = state.closed.at(-1);
    return tab ? { ...state, tabs: [...state.tabs, tab], closed: state.closed.slice(0, -1), activeId: tab.id } : state;
  }
  const id = 'id' in action ? action.id : state.activeId;
  return { ...state, tabs: state.tabs.map(t => {
    if (t.id !== id) return t;
    if (action.type === 'INITIAL_CAMERA') {
      const level = action.action.level, before = t.present.view.levelViews[level];
      const capture = (j: Journey): Journey => j.view.levelViews[level] === before
        ? { ...j, view: explorerViewReducer(j.view, action.action) } : j;
      return { ...t, present: capture(t.present), past: t.past.map(capture), future: t.future.map(capture) };
    }
    if (action.type === 'UPDATE') {
      const present = action.update(t.present);
      if (present === t.present) return t;
      const push = t.group !== action.group && !action.collapse;
      return { ...t, present, past: push ? [...t.past, t.present].slice(-HISTORY_LIMIT) : t.past, future: [], group: action.group };
    }
    if (action.type === 'UNDO') {
      const present = t.past.at(-1);
      return present ? { ...t, present, past: t.past.slice(0, -1), future: [t.present, ...t.future], group: null, restoreVersion: t.restoreVersion + 1 } : t;
    }
    if (action.type === 'REDO') {
      const present = t.future[0];
      return present ? { ...t, present, past: [...t.past, t.present], future: t.future.slice(1), group: null, restoreVersion: t.restoreVersion + 1 } : t;
    }
    return t;
  }) };
}

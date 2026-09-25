import { SetStateAction, useReducer, useRef } from 'react';
import { ExplorerAction, ExplorerViewState, explorerViewReducer } from './explorerViewState';
import { GraphFor, Journey, JourneyAction, initJourneys, journeysReducer, newJourney } from './explorerJourney';

export function flushExplorerCamera() { window.dispatchEvent(new Event('atlas:flush-camera')); }

/** `graphFor` returns the graph a journey renders; updates use it to end an outgoing stack whose
 * root they took off the map (see journeysReducer's UPDATE). It is read at dispatch time. */
export function useExplorerJourneys(initialView?: ExplorerViewState, graphFor?: GraphFor) {
  const [state, dispatch] = useReducer(journeysReducer, initialView, view => initJourneys(view ? newJourney(view) : undefined));
  const graphForRef = useRef(graphFor); graphForRef.current = graphFor;
  const active = state.tabs.find(t => t.id === state.activeId)!;
  const counter = useRef(0), group = useRef<number | null>(null);
  // All synchronous updates caused by one UI action form one undo step (scope + membership,
  // drill-down + inspection, source + pane). Each later event starts a new transaction. An update
  // that only moves the selection never becomes a step at all (ADR 0009, see journeysReducer).
  function update(fn: (j: Journey) => Journey) {
    if (group.current === null) {
      group.current = ++counter.current;
      queueMicrotask(() => { group.current = null; });
    }
    dispatch({ type: 'UPDATE', id: active.id, group: group.current, update: fn, graphFor: graphForRef.current });
  }
  function set<K extends keyof Journey>(key: K, value: SetStateAction<Journey[K]>) {
    update(j => {
      const next = typeof value === 'function' ? (value as (v: Journey[K]) => Journey[K])(j[key]) : value;
      return Object.is(j[key], next) ? j : { ...j, [key]: next };
    });
  }
  function setTransient<K extends keyof Journey>(key: K, value: SetStateAction<Journey[K]>) {
    const next = typeof value === 'function' ? (value as (v: Journey[K]) => Journey[K])(active.present[key]) : value;
    dispatch({ type: 'TRANSIENT_UPDATE', id: active.id, update: j => Object.is(j[key], next) ? j : { ...j, [key]: next } });
  }
  function setTransientCamera(action: Extract<ExplorerAction, { type: 'SET_CAMERA' }>) {
    dispatch({ type: 'TRANSIENT_UPDATE', id: active.id, update: j => {
      const view = explorerViewReducer(j.view, { ...action, generation: j.view.generation });
      return view === j.view ? j : { ...j, view };
    } });
  }
  // Targets a specific tab by ID rather than whichever tab happens to be active right now. Needed for
  // an update that completes asynchronously (loading a review comparison): the tab that requested it
  // may no longer be the active one, or may have been closed, by the time the response arrives. Its
  // own fresh group number keeps it from merging into any transaction currently in progress, and a
  // stale tab ID is a safe no-op (the reducer's UPDATE case only touches a matching `t.id`).
  // `graphFor` overrides the render-time lookup: a caller that just received the graph (a loaded
  // comparison) passes it, because React has not re-rendered with it yet.
  function updateTab(id: number, fn: (j: Journey) => Journey, graphFor: GraphFor | undefined = graphForRef.current) {
    dispatch({ type: 'UPDATE', id, group: ++counter.current, update: fn, graphFor });
  }
  function dispatchView(action: ExplorerAction, initialCamera = false) {
    if (action.type === 'RESET') {
      dispatch({ type: 'RESET', view: explorerViewReducer(active.present.view, action) });
    } else if (initialCamera && action.type === 'SET_CAMERA') {
      dispatch({ type: 'INITIAL_CAMERA', id: active.id, action });
    } else update(j => {
      const view = explorerViewReducer(j.view, action);
      return view === j.view ? j : { ...j, view };
    });
  }
  function command(action: Exclude<JourneyAction, { type: 'UPDATE' | 'INITIAL_CAMERA' | 'RESET' }>) {
    flushExplorerCamera();
    group.current = null;
    dispatch(action);
  }
  return { state, active, set, setTransient, setTransientCamera, update, updateTab, dispatchView, command, reset: (view: Journey['view']) => dispatch({ type: 'RESET', view }) };
}

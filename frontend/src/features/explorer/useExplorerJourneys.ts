import { SetStateAction, useReducer, useRef } from 'react';
import { ExplorerAction, explorerViewReducer } from './explorerViewState';
import { Journey, JourneyAction, initJourneys, journeysReducer } from './explorerJourney';

export function flushExplorerCamera() { window.dispatchEvent(new Event('atlas:flush-camera')); }

export function useExplorerJourneys() {
  const [state, dispatch] = useReducer(journeysReducer, undefined, initJourneys);
  const active = state.tabs.find(t => t.id === state.activeId)!;
  const counter = useRef(0), group = useRef<number | null>(null);
  // All synchronous updates caused by one UI action form one undo step (scope + membership,
  // drill-down + inspection, source + pane). Each later event starts a new transaction.
  function update(fn: (j: Journey) => Journey, collapse = false) {
    if (group.current === null) {
      group.current = ++counter.current;
      queueMicrotask(() => { group.current = null; });
    }
    dispatch({ type: 'UPDATE', id: active.id, group: group.current, collapse, update: fn });
  }
  function set<K extends keyof Journey>(key: K, value: SetStateAction<Journey[K]>) {
    update(j => {
      const next = typeof value === 'function' ? (value as (v: Journey[K]) => Journey[K])(j[key]) : value;
      return Object.is(j[key], next) ? j : { ...j, [key]: next };
    });
  }
  function dispatchView(action: ExplorerAction, initialCamera = false, collapse = false) {
    if (action.type === 'RESET') {
      dispatch({ type: 'RESET', view: explorerViewReducer(active.present.view, action) });
    } else if (initialCamera && action.type === 'SET_CAMERA') {
      dispatch({ type: 'INITIAL_CAMERA', id: active.id, action });
    } else update(j => {
      const view = explorerViewReducer(j.view, action);
      return view === j.view ? j : { ...j, view };
    }, collapse);
  }
  function command(action: Exclude<JourneyAction, { type: 'UPDATE' | 'INITIAL_CAMERA' | 'RESET' }>) {
    flushExplorerCamera();
    group.current = null;
    dispatch(action);
  }
  return { state, active, set, update, dispatchView, command, reset: (view: Journey['view']) => dispatch({ type: 'RESET', view }) };
}

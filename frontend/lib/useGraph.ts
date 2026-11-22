import { useEffect, useState } from 'react';
import { API_URL } from './store';
import type { GEdge, GNode } from '../components/types';

// Polls the existing /api/graph route (wider window than the 250 ms snapshot) for the explainers and analytics.
export function useGraph(windowWires = 400, everyMs = 2000) {
  const [g, setG] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  useEffect(() => {
    let stop = false;
    const load = async () => { try { const j = await (await fetch(`${API_URL}/api/graph?min=0&window=${windowWires}`)).json(); if (!stop && j.nodes) setG(j); } catch { /* offline */ } };
    load();
    const id = setInterval(load, everyMs);
    return () => { stop = true; clearInterval(id); };
  }, [windowWires, everyMs]);
  return g;
}

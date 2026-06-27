import { els } from "./dom.js";
import { state } from "./state.js";

export function installMapDebugProbe() {
  if (!new URLSearchParams(window.location.search).has("verify")) return;
  window.__icmlMapDebug = {
    forceZoom() {
      return state.mapGraph?.zoom?.() || null;
    },
    mapData() {
      return state.mapData || {};
    },
    mapSearchInfo() {
      return {
        seedCount: state.mapSearchSeedIds.size,
        semanticCount: state.mapSearchSemanticIds.size,
        kind: state.mapSearchKind,
        topScore: state.mapSearchTopScore,
        pending: state.mapSearchPending,
        message: state.mapSearchMessage,
        seedIds: [...state.mapSearchSeedIds],
        semanticIds: [...state.mapSearchSemanticIds],
      };
    },
    forceProbePoints(limit = 80) {
      if (!state.mapGraph || typeof state.mapGraph.graph2ScreenCoords !== "function") return [];
      return (state.mapGraphData?.nodes || []).slice(0, limit).map((node) => {
        const point = state.mapGraph.graph2ScreenCoords(node.x || 0, node.y || 0);
        return {
          x: point.x,
          y: point.y,
          title: node.title,
        };
      });
    },
    cytoscapeZoom() {
      return state.cyGraph?.zoom?.() || null;
    },
    cyInfo() {
      const cy = state.cyGraph;
      if (!cy) return { cy: null };
      const ext = cy.extent?.();
      const n0 = cy.nodes().length ? cy.nodes()[0] : null;
      return {
        nodes: cy.nodes().length,
        edges: cy.edges().length,
        zoom: cy.zoom(),
        containerW: els.mapCanvas.clientWidth,
        containerH: els.mapCanvas.clientHeight,
        extent: ext ? { x1: Math.round(ext.x1), y1: Math.round(ext.y1), x2: Math.round(ext.x2), y2: Math.round(ext.y2) } : null,
        n0pos: n0 ? n0.position() : null,
        n0rendered: n0 ? n0.renderedPosition() : null,
        n0visible: n0 ? n0.visible() : null,
      };
    },
    cytoscapeProbePoints(limit = 80) {
      if (!state.cyGraph) return [];
      return state.cyGraph.nodes().slice(0, limit).map((node) => {
        const point = node.renderedPosition();
        return {
          x: point.x,
          y: point.y,
          title: node.data("fullTitle") || "",
        };
      });
    },
    miniProbePoints(limit = 40) {
      if (!state.miniGraph || typeof state.miniGraph.graph2ScreenCoords !== "function") return [];
      const nodes = state.miniGraph.graphData?.().nodes || [];
      return nodes.slice(0, limit).map((node) => {
        const point = state.miniGraph.graph2ScreenCoords(node.x || 0, node.y || 0);
        return {
          x: point.x,
          y: point.y,
          title: node.title,
        };
      });
    },
    miniGraphInfo() {
      const graphData = state.miniGraph?.graphData?.();
      return {
        depth: state.miniGraphDepth,
        nodes: graphData?.nodes?.length || 0,
        links: graphData?.links?.length || 0,
        zoom: state.miniGraph?.zoom?.() || null,
      };
    },
  };
}

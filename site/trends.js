import { TRENDS_URL } from "./config.js";
import { state } from "./state.js";

export async function loadTrends() {
  if (state.trendsLoaded) return state.trendData;
  state.trendsLoaded = true;
  try {
    const response = await fetch(TRENDS_URL);
    state.trendData = response.ok ? await response.json() : null;
  } catch {
    state.trendData = null;
  }
  return state.trendData;
}

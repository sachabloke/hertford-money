import type { Adapter } from "../core/types";
import { hcc } from "./hcc";
import { ehdc } from "./ehdc";
import { htc } from "./htc";

/** Adding a council = adding an adapter here. */
export const ADAPTERS: Record<string, Adapter> = { hcc, ehdc, htc };

export function getAdapter(id: string): Adapter {
  const a = ADAPTERS[id];
  if (!a) throw new Error(`Unknown adapter "${id}". Known: ${Object.keys(ADAPTERS).join(", ")}`);
  return a;
}

import { createContext, useContext } from "react";
import type { SystemSample } from "@/lib/use-dashboard-data";

export const SystemHistoryContext = createContext<SystemSample[]>([]);

export function useSystemHistory() {
  return useContext(SystemHistoryContext);
}

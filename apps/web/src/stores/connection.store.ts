import { create } from "zustand";

/**
 * Zustand store for SSE connection status and UI-only state.
 *
 * Server state (vehicles, orders, solution) is managed by TanStack Query.
 * This store handles ephemeral UI state that doesn't come from the server.
 */
interface ConnectionState {
  isConnected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),
}));

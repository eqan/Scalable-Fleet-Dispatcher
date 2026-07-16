import type { IDraftStore } from "../../domain/ports/draft-store.port.ts";
import type { StateResponse } from "@repo/shared";
import { AppError } from "../../domain/errors.ts";
import { ok, err, type Result } from "../../shared/result.ts";

// Service factory (dependencies injected -- DIP)                    

export interface StateServiceDeps {
  draftStore: IDraftStore;
}

/**
 * Application service for reading the current planning state.
 *
 * Returns `Result<T, E>` instead of throwing -- the controller
 * unwraps the result and maps errors to HTTP responses.
 */
export const createStateService = (deps: StateServiceDeps) => {
  // Memoize last state by revision to avoid rebuilding JSON on every poll.
  // When rev changes, cache is invalidated automatically.
  let cache: { rev: number; state: StateResponse } | null = null;

  return {
    /**
     * Read the full planning state from the Redis hot store.
     *
     * Returns 503 if Redis hasn't been hydrated yet (rev is null),
     * which protects against serving partial/empty state to the UI.
     */
    getFullState: async (): Promise<Result<StateResponse, AppError>> => {
      const rev = await deps.draftStore.getRev();

      if (rev === null) {
        return err(
          AppError.serviceUnavailable(
            "State not initialized -- hydration may still be in progress",
          ),
        );
      }

      if (cache && cache.rev === rev) {
        return ok(cache.state);
      }

      const state = await deps.draftStore.getFullState();
      cache = { rev: state.rev, state };
      return ok(state);
    },
  };
};

export type StateService = ReturnType<typeof createStateService>;

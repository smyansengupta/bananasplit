"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { searchWorkspaceAction } from "@/app/app/[orgSlug]/search/actions";
import { parseQuery } from "@/lib/search/text";
import type { SearchResponse, SearchScope } from "@/lib/search/types";

/**
 * The palette's server search, as you type: a short debounce, one request
 * per pause, and only the newest request's answer is kept (an older one
 * that arrives late is dropped, so results never jump back to what you
 * typed before). Answers are remembered for the life of the palette (the
 * shell mounts a new one each time it opens), so backspacing or flipping
 * between filters is instant. While the next
 * answer loads, the last one stays on screen.
 */

export const SEARCH_DEBOUNCE_MS = 140;
const CACHE_SIZE = 50;

export type Searcher = (
  orgId: string,
  input: { query: string; scope: SearchScope },
) => Promise<SearchResponse>;

interface State {
  /** The newest answer received, possibly for an earlier query. */
  response: SearchResponse | null;
  /** The cache key `response` answers. */
  key: string | null;
  /** The key whose request failed, if the newest one did. */
  errorKey: string | null;
}

export interface WorkspaceSearch {
  response: SearchResponse | null;
  /** `response` answers exactly what is typed now. */
  current: boolean;
  /** A request for what is typed now is waiting or in flight. */
  loading: boolean;
  /** The request for what is typed now failed. */
  error: boolean;
  retry: () => void;
}

export function searchKey(query: string, scope: SearchScope): string {
  return `${scope}\n${parseQuery(query).text.toLowerCase()}`;
}

export function useWorkspaceSearch(
  orgId: string,
  open: boolean,
  query: string,
  scope: SearchScope,
  search: Searcher = searchWorkspaceAction,
): WorkspaceSearch {
  const [state, setState] = useState<State>({ response: null, key: null, errorKey: null });
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, SearchResponse>());
  const seq = useRef(0);
  const key = searchKey(query, scope);
  const text = parseQuery(query).text;

  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    const cached = cache.current.get(key);
    // Pages are matched in the browser (catalog.ts): the server has nothing for that filter.
    const local = scope === "pages";
    // The palette's home and cached answers show at once; typing waits for a pause.
    const delay = cached || local || !text ? 0 : SEARCH_DEBOUNCE_MS;
    const timer = setTimeout(async () => {
      if (cached) {
        setState({ response: cached, key, errorKey: null });
        return;
      }
      try {
        const response: SearchResponse = local
          ? { query: text, scope, groups: [] }
          : await search(orgId, { query: text, scope });
        if (id !== seq.current) return;
        cache.current.set(key, response);
        if (cache.current.size > CACHE_SIZE) {
          cache.current.delete(cache.current.keys().next().value!);
        }
        setState({ response, key, errorKey: null });
      } catch {
        if (id !== seq.current) return;
        setState((s) => ({ ...s, errorKey: key }));
      }
    }, delay);
    return () => clearTimeout(timer);
    // `attempt` re-runs a failed search.
  }, [open, key, text, scope, orgId, search, attempt]);

  const retry = useCallback(() => {
    cache.current.delete(key);
    setState((s) => ({ ...s, errorKey: null }));
    setAttempt((n) => n + 1);
  }, [key]);

  const current = state.response !== null && state.key === key;
  const error = state.errorKey === key;
  return {
    response: state.response,
    current,
    loading: open && !current && !error,
    error,
    retry,
  };
}

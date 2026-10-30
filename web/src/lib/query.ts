import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** GET a URL as server state. The URL is the cache key, so invalidation can match by prefix. */
export function useApi<T>(url: string | null, options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">) {
  return useQuery<T>({
    queryKey: [url],
    queryFn: () => api.get<T>(url!),
    enabled: url !== null && (options?.enabled ?? true),
    ...options,
  });
}

/** Invalidate every cached GET whose URL starts with one of the prefixes. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) =>
    qc.invalidateQueries({
      predicate: (q) => {
        const key = String(q.queryKey[0] ?? "");
        return prefixes.some((p) => key.startsWith(p));
      },
    });
}

/** A mutation that invalidates related URLs on success. */
export function useAction<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: string[] | ((vars: TVars) => string[]) = []) {
  const inv = useInvalidate();
  return useMutation<TResult, Error, TVars>({
    mutationFn: fn,
    onSuccess: async (_r, vars) => {
      const prefixes = typeof invalidate === "function" ? invalidate(vars) : invalidate;
      if (prefixes.length) await inv(...prefixes);
    },
  });
}

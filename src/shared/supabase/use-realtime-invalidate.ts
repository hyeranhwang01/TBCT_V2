"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/shared/supabase/client";

type Subscription = { table: string; filter?: string };

/**
 * Replaces `refetchInterval` polling with a Supabase Realtime subscription
 * that just triggers a refetch of the SAME React Query key on any change --
 * it is deliberately not a data source itself (the CDC payload is never
 * read here). The existing `queryFn` still runs through the same authorized
 * RPC route it always did (see the realtime-migration plan's rationale:
 * keep writes/reads on the existing path, only swap the refetch trigger
 * from a timer to a websocket event). Requires RLS to be enabled on every
 * subscribed table (sql/009_row_level_security.sql) -- otherwise the CDC
 * broadcast itself would leak rows to any subscriber regardless of this
 * hook's own behavior.
 */
export function useRealtimeInvalidate(subscriptions: Subscription[], queryKey: QueryKey, enabled = true) {
  const queryClient = useQueryClient();
  const subsKey = JSON.stringify(subscriptions);
  const queryKeyStr = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) return undefined;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`rt:${queryKeyStr}`);
    for (const sub of subscriptions) {
      channel.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: sub.table, ...(sub.filter ? { filter: sub.filter } : {}) } as never,
        () => {
          void queryClient.invalidateQueries({ queryKey });
        },
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, subsKey, queryKeyStr, queryClient]);
}

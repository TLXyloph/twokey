"use client";

/**
 * The "Live Balance" custom widget, drawn as the balances strip: up to three cells in one card,
 * split by 1px dividers (available balance, waiting for a second key, money in this month). The
 * cells come from ./balances-strip.ts; this file only fetches through Studio (`widgetApi.getData`,
 * so page filters and the data panel's formatting apply) and draws them.
 *
 * It queries again whenever the judge UI pushes new board data into Studio (Studio's own refresh
 * re-renders a custom widget without re-running its query), and it adds the shared sandbox balance
 * under the available balance straight from the live board view, which Studio does not hold.
 */
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useBoardView } from "@/ui/judge/use-judge";
import { balancesStripCells, planStripQueries, STRIP_SLOTS, toStripFigures, type StripFigures, type StripSlot } from "./balances-strip";
import { getStudioDataRevision, subscribeStudioData } from "./studio-handle";
import { tokens } from "./tokens";
import type { LiveBalanceWidgetState } from "./widgets";
import "./live-balance-widget.css";

const stripColours = {
  "--tk-strip-text": tokens.text,
  "--tk-strip-muted": tokens.muted,
  "--tk-strip-border": tokens.border,
} as CSSProperties;

export function LiveBalanceWidget({ dataMapping, widgetApi }: AgWidgetParams<LiveBalanceWidgetState>) {
  const [loaded, setLoaded] = useState<{ figures: StripFigures; mapped: Partial<Record<StripSlot, AgWidgetField>> }>();
  // After the first load, a refresh keeps the old figures on screen under a quiet loading indicator.
  const hasLoaded = useRef(false);
  const dataRevision = useSyncExternalStore(subscribeStudioData, getStudioDataRevision, () => 0);
  const shared = useBoardView().view?.sharedBalance ?? null;

  useEffect(() => {
    const mapped: Partial<Record<StripSlot, AgWidgetField>> = {};
    for (const slot of STRIP_SLOTS) {
      const field = dataMapping[slot]?.[0];
      if (field) mapped[slot] = field;
    }
    if (!mapped.value || !mapped.asOf) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }

    let stale = false;
    const fail = () => {
      hasLoaded.current = false;
      setLoaded(undefined);
      widgetApi.setDisplayState("noData");
    };
    widgetApi.setDisplayState("loading", { prominent: !hasLoaded.current });

    Promise.all(
      planStripQueries(mapped).map(async (query) => {
        const { results } = await widgetApi.getData({ fields: query.fields }, { queryId: query.queryId });
        return { query, row: results.rows[0] };
      }),
    )
      .then((answers) => {
        if (stale) return;
        const values: Partial<Record<StripSlot, unknown>> = {};
        for (const { query, row } of answers) {
          query.slots.forEach((slot, i) => {
            values[slot] = row?.[query.fields[i]!.key];
          });
        }
        const figures = toStripFigures(values, new Set(Object.keys(mapped) as StripSlot[]));
        if (!figures) return fail();
        hasLoaded.current = true;
        setLoaded({ figures, mapped });
        widgetApi.setDisplayState("displayed");
      })
      .catch((error: unknown) => {
        if (stale) return;
        console.warn("[Live Balance] could not load the balances", error);
        fail();
      });

    return () => {
      stale = true;
    };
    // dataRevision: each push of new board data into Studio means the sums have changed.
  }, [dataMapping, widgetApi, dataRevision]);

  const cells = loaded
    ? balancesStripCells({ ...loaded.figures, shared }, (amount, slot) => widgetApi.formatFieldValue(loaded.mapped[slot]!, amount))
    : undefined;

  return (
    <dl className="tk-strip" style={stripColours} aria-live="polite">
      {cells?.map((cell) => (
        <div key={cell.id} className="tk-strip__cell" data-zero={cell.zero || undefined}>
          <dt className="tk-strip__label">{cell.label}</dt>
          <dd className="tk-strip__value">{cell.value}</dd>
          <dd className="tk-strip__caption">{cell.caption}</dd>
          {cell.note && <dd className="tk-strip__caption tk-strip__note">{cell.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

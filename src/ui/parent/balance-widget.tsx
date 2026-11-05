"use client";

/**
 * The parent balance widget: the board's custom Live Balance widget (src/ui/studio/live-balance-widget.tsx)
 * adapted for parents. Same data mapping, same queries through Studio (`widgetApi.getData`, one per
 * table, ./../studio/balances-strip.ts), so page filters and the data's formatting apply; parent
 * words (./balance-cells.ts); and no colours of its own. It reads the theme back from Studio's CSS
 * variables (--ag-text-color, --ag-subtle-text-color, --ag-studio-widget-title-font-family), so the
 * parent theme (./theme.ts) dresses it, and so would any other.
 *
 * When the session's ledger moves (a ticket bought, a payout sent), the changed figure arrives in
 * place: it is keyed by its text, so the new one enters from 6px below. The first load does not move.
 */
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { planStripQueries, STRIP_SLOTS, toStripFigures, type StripFigures, type StripSlot } from "@/ui/studio/balances-strip";
import { parentBalanceCells } from "./balance-cells";
import { parentStudio } from "./parent-handle";
import type { ParentBalanceWidgetState } from "./widgets";
import "./balance-widget.css";

type Loaded = { figures: StripFigures; mapped: Partial<Record<StripSlot, AgWidgetField>> };

export function ParentBalanceWidget({ dataMapping, widgetApi }: AgWidgetParams<ParentBalanceWidgetState>) {
  const [loaded, setLoaded] = useState<Loaded>();
  const hasLoaded = useRef(false);
  // Figures change in place only after the first load; that first render never animates.
  const [ticking, setTicking] = useState(false);
  const revision = useSyncExternalStore(parentStudio.subscribe, parentStudio.getRevision, () => 0);

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
        setTicking(hasLoaded.current);
        hasLoaded.current = true;
        setLoaded({ figures, mapped });
        widgetApi.setDisplayState("displayed");
      })
      .catch((error: unknown) => {
        if (stale) return;
        console.warn("[Parent balance] could not load the balances", error);
        fail();
      });

    return () => {
      stale = true;
    };
    // revision: each push of new club data into Studio means the sums may have changed.
  }, [dataMapping, widgetApi, revision]);

  const cells = loaded
    ? parentBalanceCells(loaded.figures, (amount, slot) => widgetApi.formatFieldValue(loaded.mapped[slot]!, amount))
    : undefined;

  return (
    <dl className="pk-balance" aria-live="polite">
      {cells?.map((cell) => (
        <div key={cell.id} className="pk-balance__cell" data-zero={cell.zero || undefined} data-cell={cell.id}>
          <dt className="pk-balance__label">{cell.label}</dt>
          <dd key={cell.value} className="pk-balance__value" data-tick={ticking || undefined}>
            {cell.value}
          </dd>
          <dd className="pk-balance__caption">{cell.caption}</dd>
        </div>
      ))}
    </dl>
  );
}

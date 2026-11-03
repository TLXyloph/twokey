"use client";

/**
 * The "Live Balance" custom widget, drawn as the balances strip: up to three cells in one card,
 * split by 1px dividers (available balance, waiting for a second key, money in this month). The
 * cells come from ./balances-strip.ts; this file only fetches through Studio (`widgetApi.getData`,
 * so page filters and the data panel's formatting apply) and draws them.
 */
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { balancesStripCells, planStripQueries, STRIP_SLOTS, toStripFigures, type StripCell, type StripSlot } from "./balances-strip";
import { tokens } from "./tokens";
import type { LiveBalanceWidgetState } from "./widgets";
import "./live-balance-widget.css";

const stripColours = {
  "--tk-strip-text": tokens.text,
  "--tk-strip-muted": tokens.muted,
  "--tk-strip-border": tokens.border,
} as CSSProperties;

export function LiveBalanceWidget({ dataMapping, widgetApi }: AgWidgetParams<LiveBalanceWidgetState>) {
  const [cells, setCells] = useState<StripCell[]>();
  // After the first load, a refresh keeps the old figures on screen under a quiet loading indicator.
  const hasLoaded = useRef(false);

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
      setCells(undefined);
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
        setCells(balancesStripCells(figures, (amount, slot) => widgetApi.formatFieldValue(mapped[slot]!, amount)));
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
  }, [dataMapping, widgetApi]);

  return (
    <dl className="tk-strip" style={stripColours} aria-live="polite">
      {cells?.map((cell) => (
        <div key={cell.id} className="tk-strip__cell" data-zero={cell.zero || undefined}>
          <dt className="tk-strip__label">{cell.label}</dt>
          <dd className="tk-strip__value">{cell.value}</dd>
          <dd className="tk-strip__caption">{cell.caption}</dd>
        </div>
      ))}
    </dl>
  );
}

"use client";

/**
 * The "Live Balance" custom widget: the club account's balance as one large figure, with the time it
 * was read and where from. Data comes through Studio (`widgetApi.getData`), so filters and the data
 * panel's formatting apply; colours and type come from the theme's `--ag-*` variables.
 */
import type { AgWidgetParams } from "ag-studio";
import { useEffect, useRef, useState } from "react";
import type { LiveBalanceWidgetState } from "./widgets";
import "./live-balance-widget.css";

interface Shown {
  balance: string;
  asOf: string;
}

export function LiveBalanceWidget({ dataMapping, widgetApi }: AgWidgetParams<LiveBalanceWidgetState>) {
  const [shown, setShown] = useState<Shown>();
  // After the first load, refreshes keep the old figure visible under a quiet loading indicator.
  const hasLoaded = useRef(false);

  useEffect(() => {
    const valueField = dataMapping.value?.[0];
    const asOfField = dataMapping.asOf?.[0];
    if (!valueField || !asOfField) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }

    let stale = false;
    widgetApi.setDisplayState("loading", { prominent: !hasLoaded.current });
    widgetApi
      .getData({ fields: [valueField, asOfField] })
      .then(({ results }) => {
        if (stale) return;
        const row = results.rows[0];
        const balance: unknown = row?.[valueField.key];
        if (balance == null) {
          hasLoaded.current = false;
          setShown(undefined);
          widgetApi.setDisplayState("noData");
          return;
        }
        hasLoaded.current = true;
        setShown({
          balance: widgetApi.formatFieldValue(valueField, balance),
          asOf: widgetApi.formatFieldValue(asOfField, row?.[asOfField.key]),
        });
        widgetApi.setDisplayState("displayed");
      })
      .catch((error: unknown) => {
        if (stale) return;
        console.warn("[Live Balance] could not load the balance", error);
        hasLoaded.current = false;
        setShown(undefined);
        widgetApi.setDisplayState("noData");
      });

    return () => {
      stale = true;
    };
  }, [dataMapping, widgetApi]);

  return (
    <div className="tk-live-balance">
      <p className="tk-live-balance__value" aria-live="polite">
        {shown?.balance ?? ""}
      </p>
      <p className="tk-live-balance__caption">
        as of {shown?.asOf || "an unknown time"} · PayPal sandbox
      </p>
      <span className="tk-live-balance__badge">demo data</span>
    </div>
  );
}

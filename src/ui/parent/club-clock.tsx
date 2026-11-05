"use client";

/**
 * The club's time, in the footer: every time on the page is Riverbend's (America/Chicago), and this
 * says what time it is there now. The server renders no time (it would differ by the time the page
 * hydrates); the browser fills it in and moves it on each minute.
 */
import { useEffect, useState } from "react";
import { CLUB_TIME_ZONE } from "@/demo/riverbend";

const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: CLUB_TIME_ZONE, timeZoneName: "short" });

export function ClubClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(clock.format(new Date()));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return <span className="foot__clock">{now ?? "Central time"}</span>;
}

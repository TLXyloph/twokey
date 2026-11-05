"use client";

/**
 * "Did each event's takings arrive?": one event at a time, at poster size. A parent picks an event
 * (native radios, so arrow keys move between them and a screen reader announces a group) and the
 * figure answers: what the ledger records against it, of what its count says to expect, with the
 * working-out beside it. The page opens on the event with the largest gap (the car wash).
 *
 * Three parts, no wrapper, so the chapter's grid places each one (takings.css).
 */
import { useState } from "react";
import { eventTakings, storyEventId } from "./parent-model";
import { useClubData } from "./use-parent";

export function TakingsFigure() {
  const { data } = useClubData();
  const events = eventTakings(data);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = events.find((e) => e.id === picked) ?? events.find((e) => e.id === storyEventId(events));
  if (!shown) return null;

  return (
    <>
      <fieldset className="picker" data-ui="" data-reveal="">
        <legend className="visually-hidden">Event</legend>
        <div className="picker__track">
          {events.map((event) => (
            <label key={event.id} className="picker__option">
              <input
                className="picker__input"
                type="radio"
                name="takings-event"
                value={event.id}
                checked={event.id === shown.id}
                onChange={() => setPicked(event.id)}
              />
              <span className="picker__text">{event.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="takings__figure" aria-live="polite" data-reveal="">
        <span key={`${shown.id}:${shown.received}`} className="takings__received">
          {shown.received}
        </span>{" "}
        <span className="takings__unit">of {shown.expected} expected</span>
      </p>

      <p className="takings__working" aria-live="polite" data-reveal="">
        <strong className="takings__event">
          {shown.name}, {shown.day}.
        </strong>{" "}
        {shown.sentence}
      </p>
    </>
  );
}

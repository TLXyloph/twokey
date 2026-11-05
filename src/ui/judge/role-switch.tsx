"use client";

/**
 * "Acting as": President / Treasurer / Secretary / Parent, as a segmented control. Native radios, so
 * arrow keys move between roles and screen readers announce a radio group; the inputs sit invisibly
 * over their labels. Two of these are on the page (the judge bar and the drawer); both read and set
 * the one role store, so they always agree.
 */
import { ACTING_ROLES, roleTitle } from "./judge-model";
import { roleStore } from "./role-store";
import { useActingRole } from "./use-judge";

export function RoleSwitch({ name }: { name: string }) {
  const role = useActingRole();
  const labelId = `${name}-label`;
  return (
    <div className="judge-role">
      <span id={labelId} className="judge-role__label">
        Acting as
      </span>
      <div className="judge-role__track" role="radiogroup" aria-labelledby={labelId}>
        {ACTING_ROLES.map((option) => (
          <label key={option} className="judge-role__option">
            <input
              className="judge-role__input"
              type="radio"
              name={name}
              value={option}
              checked={role === option}
              onChange={() => roleStore.set(option)}
            />
            <span className="judge-role__text">{roleTitle(option)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

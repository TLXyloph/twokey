import type { CSSProperties } from "react";

/** Inline CSS custom properties (`--i`, `--d`, `--share`), typed for React's style prop. */
export const vars = (values: Record<`--${string}`, string | number>): CSSProperties => values as CSSProperties;

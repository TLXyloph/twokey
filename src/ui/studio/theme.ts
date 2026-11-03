/**
 * PLACEHOLDER THEME, to be replaced in the design-tweakables pass. Do not polish it here.
 *
 * Calm and civic: navy and slate ink on white surfaces, a pale slate canvas, one blue accent and a
 * modest radius. Every widget, the Live Balance widget included, inherits these through Studio's
 * `--ag-*` CSS variables, so changing a value here restyles the whole dashboard.
 */
import { studioTheme } from "ag-studio";

const ink = "#1e293b"; // slate-800: body text
const navy = "#14213d"; // headings, icons
const muted = "#5b6676"; // secondary text
const accent = "#1d4ed8"; // the one accent
const highlight = "#e8eefc"; // accent at low strength, for hover and selection
const surface = "#ffffff";
const canvas = "#f4f6f9";
const border = "#d6dce4";
const gridline = "#e7ebf0";
const font = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const line = (color: string) => ({ width: 1, color });

export const twoKeyStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: font,
  fontSize: 14,
  textColor: ink,
  foregroundColor: ink,
  subtleTextColor: muted,
  backgroundColor: surface,
  borderColor: border,
  borderRadius: 6,
  accentColor: accent,
  iconColor: navy,
  rowHoverColor: highlight,

  // Canvas: a quiet page behind white widget cards.
  studioWrapperBackgroundColor: canvas,
  studioCanvasBackgroundColor: canvas,
  studioCanvasFontFamily: font,

  // Widgets: white cards, thin border, modest radius.
  studioWidgetBackgroundColor: surface,
  studioWidgetBorder: line(border),
  studioWidgetBorderRadius: 8,
  studioWidgetTitleFontFamily: font,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: navy,
  studioWidgetSubtitleTextColor: muted,
  studioWidgetCaptionTextColor: muted,

  // Grids.
  gridFontFamily: font,
  gridCellTextColor: ink,
  gridHeaderBackgroundColor: surface,
  gridHeaderTextColor: muted,
  gridHeaderFontWeight: 600,
  gridRowBorder: line(gridline),
  gridHeaderRowBorder: line(border),
  gridRowHoverColor: highlight,
  gridWrapperBorder: false,

  // Charts: the accent first, then navy and slate.
  chartFontFamily: font,
  chartTextColor: ink,
  chartSubtleTextColor: muted,
  chartAxisLineColor: border,
  chartGridLineColor: gridline,
  chartPaletteFills1Color: accent,
  chartPaletteStrokes1Color: accent,
  chartPaletteFills2Color: navy,
  chartPaletteStrokes2Color: navy,
  chartPaletteFills3Color: "#94a3b8",
  chartPaletteStrokes3Color: "#94a3b8",
});

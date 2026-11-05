/**
 * AG Studio's theme for the parent ledger: the club's team colours, a second theme on the same
 * Studio as the board's (src/ui/studio/theme.ts), built the same way: `studioTheme.withParams`
 * (types: node_modules/ag-studio/dist/types/api/theme/{sharedTheme,coreTheme,gridTheme,chartTheme}.d.ts).
 *
 * - Studio's chrome is gone: the wrapper, the canvas and the page share the maroon ground, with no
 *   frame, no shadow and no grid lines (the parent page opens in view mode, ./parent-setup.ts).
 * - Widgets are square panels one tone step up from the ground (#4d0519), with no border: surfaces
 *   part by tone, not by lines. Their titles are set in Bricolage Grotesque, the club's display face.
 * - Every word is gold. Tables keep their row rules (a real table may have lines), one step off the
 *   panel. Studio's browser colour scheme is dark, so its scrollbars and inputs match.
 * - Charts: gold for received (the main series), a dusty rose for expected, coral for anything a
 *   third series adds, muted gold after that. Contrast is in ./tokens.ts.
 * - The custom balance widget reads the same params back as CSS variables (--ag-text-color and the
 *   rest), so this theme alone dresses it (./balance-widget.tsx).
 */
import { studioTheme } from "ag-studio";
import { PARENT_CANVAS_PADDING, PARENT_CANVAS_PADDING_MEDIUM } from "./parent-grid";
import { displayFont, parentTokens as t, textFont } from "./tokens";

const hairline = (color: string) => ({ width: 1, color });

export const parentStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  browserColorScheme: "dark",
  fontFamily: textFont,
  fontSize: 15,
  textColor: t.ink,
  foregroundColor: t.ink,
  subtleTextColor: t.muted,
  backgroundColor: t.surface,
  borderColor: t.rule,
  borderRadius: 0,
  accentColor: t.ink,
  iconColor: t.muted,
  rowHoverColor: t.raised,
  invalidColor: t.short,
  menuBackgroundColor: t.surface,
  menuTextColor: t.ink,
  tooltipBackgroundColor: t.ink,
  tooltipTextColor: t.ground,

  // The open plane: wrapper, canvas and page all on the maroon ground, no frame, no shadow.
  studioWrapperBackgroundColor: t.ground,
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioCanvasBackgroundColor: t.ground,
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasPadding: PARENT_CANVAS_PADDING,
  studioCanvasRowHeight: 16,
  studioCanvasFontFamily: textFont,
  studioCanvasGridLineColor: t.ground,
  studioPanelContainerBackgroundColor: t.ground,
  studioPanelContainerBorder: false,

  // Widgets: square gold-on-maroon panels, parted from the ground by tone alone.
  studioWidgetBackgroundColor: t.surface,
  studioWidgetBorder: false,
  studioWidgetBorderRadius: 0,
  studioWidgetPadding: 16,
  studioWidgetTitleFontFamily: displayFont,
  studioWidgetTitleFontSize: 24,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: t.ink,
  studioWidgetSubtitleFontFamily: textFont,
  studioWidgetSubtitleFontSize: 15,
  studioWidgetSubtitleTextColor: t.muted,
  studioWidgetCaptionFontFamily: textFont,
  studioWidgetCaptionFontSize: 14,
  studioWidgetCaptionTextColor: t.muted,
  studioWidgetLoadingOverlayBackgroundColor: t.surface,
  studioWidgetNoDataOverlayBackgroundColor: t.surface,
  studioWidgetToolbarBackgroundColor: t.ground,
  studioWidgetToolbarButtonColor: t.ink,
  studioWidgetToolbarButtonHoverBackgroundColor: t.raised,

  // Tables: gold figures on the panel, muted sentence-case headers, row rules one step off the panel.
  gridBrowserColorScheme: "dark",
  gridFontFamily: textFont,
  gridFontSize: 15,
  gridCellTextColor: t.ink,
  gridDataBackgroundColor: t.surface,
  gridOddRowBackgroundColor: t.surface,
  gridHeaderBackgroundColor: t.surface,
  gridHeaderTextColor: t.muted,
  gridHeaderFontWeight: 500,
  gridHeaderFontSize: 14,
  gridHeaderHeight: 40,
  gridRowHeight: 46,
  gridRowBorder: hairline(t.rule),
  gridHeaderRowBorder: hairline(t.rule),
  gridColumnBorder: false,
  gridRowHoverColor: t.raised,
  gridWrapperBorder: false,
  gridWrapperBorderRadius: 0,
  gridIconColor: t.muted,
  gridAccentColor: t.ink,

  // Charts: received in gold, expected in dusty rose, on the panel with quiet axes.
  chartFontFamily: textFont,
  chartFontSize: 14,
  chartChartPadding: 8,
  chartTextColor: t.ink,
  chartSubtleTextColor: t.muted,
  chartAxisLineColor: t.muted,
  chartGridLineColor: t.rule,
  chartTooltipBackgroundColor: t.ground,
  chartTooltipTextColor: t.ink,
  chartTooltipBorder: hairline(t.muted),
  chartTooltipBorderRadius: 0,
  chartCrosshairLabelBackgroundColor: t.ink,
  chartCrosshairLabelTextColor: t.ground,
  chartPaletteFills1Color: t.ink,
  chartPaletteStrokes1Color: t.ink,
  chartPaletteFills2Color: t.comparison,
  chartPaletteStrokes2Color: t.comparison,
  chartPaletteFills3Color: t.short,
  chartPaletteStrokes3Color: t.short,
  chartPaletteFills4Color: t.muted,
  chartPaletteStrokes4Color: t.muted,
});

/** Between 720 and 1099px the page margin is 24px: a 12px inset keeps the panels on it. */
export const parentMediumStudioTheme = parentStudioTheme.withParams({
  studioCanvasPadding: PARENT_CANVAS_PADDING_MEDIUM,
});

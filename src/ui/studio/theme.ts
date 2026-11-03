/**
 * AG Studio's theme for the board: the achromatic ledger (see ./tokens.ts). No colour in the chrome:
 * Studio's accent (selection, focus, checkboxes) is the ink, its panels sit on the stone ground split
 * by hairlines, widgets are white cards with a 1px edge and no shadow, and the only hue is the club
 * maroon on the first chart series.
 */
import { studioTheme } from "ag-studio";
import { radius, textFont, tokens as t } from "./tokens";

const hairline = (color: string) => ({ width: 1, color });

export const twoKeyStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: textFont,
  fontSize: 14,
  textColor: t.text,
  foregroundColor: t.text,
  subtleTextColor: t.muted,
  backgroundColor: t.surface,
  borderColor: t.border,
  borderRadius: radius.control,
  accentColor: t.text,
  iconColor: t.muted,
  rowHoverColor: t.raised,
  invalidColor: t.data,
  menuBackgroundColor: t.surface,
  tooltipBackgroundColor: t.text,
  tooltipTextColor: t.surface,

  // Inputs: white with the control edge; focus darkens the edge to ink.
  inputBackgroundColor: t.surface,
  inputBorder: hairline(t.control),
  inputBorderRadius: radius.control,
  inputFocusBorder: hairline(t.text),
  inputPlaceholderTextColor: t.faint,
  inputIconColor: t.muted,

  // The open plane: wrapper, canvas and panels all on the ground, no frame and no shadow.
  studioWrapperBackgroundColor: t.ground,
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioCanvasBackgroundColor: t.ground,
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 16,
  studioCanvasFontFamily: textFont,
  studioCanvasGridLineColor: t.rule,
  studioPanelContainerBackgroundColor: t.ground,
  studioPanelContainerBorder: false,
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: t.border,
  studioPanelDividerActiveColor: t.control,
  studioPanelSectionBorderColor: t.border,
  studioPanelHeaderFontFamily: textFont,
  studioPanelHeaderFontSize: 14,
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: t.active,
  studioPanelChevronButtonHoverColor: t.text,
  studioToggleButtonActiveBackgroundColor: t.active,
  studioToggleButtonActiveBorderColor: t.control,
  studioToggleButtonActiveColor: t.text,
  studioFormLabelColor: t.muted,
  studioAiPanelInputMessageBackgroundColor: t.raised,
  studioAiPanelButtonHoverBackgroundColor: t.active,
  studioAiPanelRichTextAccentBackgroundColor: t.active,

  // Widgets: white cards, 1px edge, 8px radius, no shadow at rest.
  studioWidgetBackgroundColor: t.surface,
  studioWidgetBorder: hairline(t.border),
  studioWidgetBorderRadius: radius.card,
  studioWidgetPadding: 12,
  studioWidgetResizeBorderColor: t.text,
  studioWidgetTitleFontFamily: textFont,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: t.text,
  studioWidgetSubtitleFontFamily: textFont,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: t.muted,
  studioWidgetCaptionFontFamily: textFont,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: t.muted,
  studioWidgetLoadingOverlayBackgroundColor: t.surface,
  studioWidgetNoDataOverlayBackgroundColor: t.surface,

  // Tables: rules and alignment. Grey sentence-case headers, no band, no zebra, row rules one step
  // lighter than the card edge.
  gridFontFamily: textFont,
  gridFontSize: 14,
  gridCellTextColor: t.text,
  gridDataBackgroundColor: t.surface,
  gridOddRowBackgroundColor: t.surface,
  gridHeaderBackgroundColor: t.surface,
  gridHeaderTextColor: t.muted,
  gridHeaderFontWeight: 400,
  gridHeaderFontSize: 12,
  gridHeaderHeight: 36,
  gridRowHeight: 40,
  gridRowBorder: hairline(t.rule),
  gridHeaderRowBorder: hairline(t.border),
  gridColumnBorder: false,
  gridRowHoverColor: t.raised,
  gridWrapperBorder: false,
  gridIconColor: t.muted,

  // Charts: the maroon on the first series (the main data element), the comparison grey second,
  // ink and greys for anything an editor adds after.
  chartFontFamily: textFont,
  chartFontSize: 12,
  chartTextColor: t.text,
  chartSubtleTextColor: t.muted,
  chartAxisLineColor: t.control,
  chartGridLineColor: t.border,
  chartTooltipBackgroundColor: t.surface,
  chartTooltipTextColor: t.text,
  chartTooltipBorder: hairline(t.border),
  chartPaletteFills1Color: t.data,
  chartPaletteStrokes1Color: t.data,
  chartPaletteFills2Color: t.comparison,
  chartPaletteStrokes2Color: t.comparison,
  chartPaletteFills3Color: t.text,
  chartPaletteStrokes3Color: t.text,
  chartPaletteFills4Color: t.muted,
  chartPaletteStrokes4Color: t.muted,
});

export const MOBILE_SIDEBAR_BREAKPOINT = 860;
export const IMMERSIVE_PREVIEW_BREAKPOINT = 1180;
export const DETAIL_PANEL_MIN_WIDTH = 360;
export const DETAIL_PANEL_MAX_WIDTH = 1600;
export const IMMERSIVE_DETAIL_PANEL_MIN_WIDTH = 280;
export const SIDEBAR_EXPANDED_WIDTH = 260;
export const IMMERSIVE_CHAT_CONTENT_MIN = 300;
export const IMMERSIVE_CHAT_CONTENT_MAX = 1600;

export function shouldUseImmersivePreview(viewportWidth: number): boolean {
  return viewportWidth >= IMMERSIVE_PREVIEW_BREAKPOINT;
}

export function getPreferredDetailPanelWidth(viewportWidth: number): number {
  const roomyWidth = Math.round(viewportWidth * 0.52);
  return Math.min(viewportWidth, DETAIL_PANEL_MAX_WIDTH, Math.max(720, roomyWidth));
}

export function clampDetailWidth(
  width: number,
  viewportWidth: number,
  immersive: boolean,
  sidebarOpen: boolean,
): number {
  if (!immersive) {
    const maxWidth = Math.min(DETAIL_PANEL_MAX_WIDTH, viewportWidth);
    const minWidth = Math.min(DETAIL_PANEL_MIN_WIDTH, maxWidth);
    return Math.min(maxWidth, Math.max(minWidth, width));
  }

  const sidebarWidth = sidebarOpen ? SIDEBAR_EXPANDED_WIDTH : 0;
  const availableWidth = Math.max(0, viewportWidth - sidebarWidth);
  const minWidth = Math.min(
    Math.max(IMMERSIVE_DETAIL_PANEL_MIN_WIDTH, availableWidth - IMMERSIVE_CHAT_CONTENT_MAX),
    availableWidth,
  );
  const maxWidth = Math.min(DETAIL_PANEL_MAX_WIDTH, availableWidth - IMMERSIVE_CHAT_CONTENT_MIN);
  return Math.min(maxWidth, Math.max(minWidth, width));
}

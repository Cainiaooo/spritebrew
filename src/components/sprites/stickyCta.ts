import type { CSSProperties } from 'react';

export const STICKY_CTA_SPACER_CLASS_NAME =
  'h-[calc(6rem+env(safe-area-inset-bottom))] sm:h-[calc(5rem+env(safe-area-inset-bottom))]';

export const STICKY_CTA_BAR_CLASS_NAME =
  'fixed bottom-0 left-0 right-0 z-30 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md border-t min-h-[calc(6rem+env(safe-area-inset-bottom))] sm:min-h-[calc(5rem+env(safe-area-inset-bottom))] lg:left-[var(--sidebar-width)]';

export const STICKY_CTA_BAR_STYLE: CSSProperties = {
  backgroundColor: 'rgba(20, 18, 16, 0.92)',
  borderColor: '#3a3430',
};

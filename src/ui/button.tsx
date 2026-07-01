// Re-export of agentic-ui Button (with its CSS) plus an IconButton wrapper that
// renders a lucide-react icon (and optional label) in a flex row.
import { forwardRef } from 'react';
import { Button, type ButtonProps } from '@brijbyte/agentic-ui/button';
import type { LucideIcon } from 'lucide-react';
import '@brijbyte/agentic-ui/button.css';

export { Button };
export type { ButtonProps };

export interface IconButtonProps extends ButtonProps {
  /** A lucide-react icon component. */
  icon: LucideIcon;
  /** Icon pixel size. @default 16 */
  iconSize?: number;
}

/** agentic-ui Button rendering an icon + optional children in a flex-row span. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon: Icon, iconSize = 16, iconOnly, children, ...props },
    ref
  ) {
    return (
      <Button ref={ref} iconOnly={iconOnly ?? !children} {...props}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon size={iconSize} aria-hidden />
          {children}
        </span>
      </Button>
    );
  }
);

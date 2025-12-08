import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
  useId,
  useState,
} from 'react';
import '../styles/tooltip.css';

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

type TriggerProps = {
  onMouseEnter?: (event: SyntheticEvent) => void;
  onMouseLeave?: (event: SyntheticEvent) => void;
  onFocus?: (event: SyntheticEvent) => void;
  onBlur?: (event: SyntheticEvent) => void;
  'aria-describedby'?: string;
};

export type TooltipProps = {
  content: ReactNode;
  placement?: TooltipPlacement;
  className?: string;
  children: ReactElement<TriggerProps>;
};

function mergeHandler<T extends SyntheticEvent>(existing?: (event: T) => void, next?: (event: T) => void) {
  return (event: T) => {
    existing?.(event);
    next?.(event);
  };
}

export function Tooltip({ content, placement = 'top', className, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        onMouseEnter: mergeHandler(children.props.onMouseEnter, show),
        onMouseLeave: mergeHandler(children.props.onMouseLeave, hide),
        onFocus: mergeHandler(children.props.onFocus, show),
        onBlur: mergeHandler(children.props.onBlur, hide),
        'aria-describedby': open ? tooltipId : undefined,
      })
    : children;

  return (
    <span className={`tooltip ${className ?? ''}`.trim()}>
      {trigger}
      <span role="tooltip" id={tooltipId} className={`tooltip-content tooltip-${placement} ${open ? 'is-open' : ''}`}>
        {content}
      </span>
    </span>
  );
}

export default Tooltip;

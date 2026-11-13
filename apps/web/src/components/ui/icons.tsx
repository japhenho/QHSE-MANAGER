import type { ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;
export type IconComponent = (props: IconProps) => ReactNode;

/** Decorative by default (`aria-hidden`): the accessible name always comes from adjacent text. */
function createIcon(paths: ReactNode): IconComponent {
  return function Icon(props: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const HomeIcon = createIcon(
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </>,
);

export const ActivityIcon = createIcon(<path d="M3 12h4l3-8 4 16 3-8h4" />);

export const MenuIcon = createIcon(<path d="M4 6h16M4 12h16M4 18h16" />);

export const CloseIcon = createIcon(<path d="M6 6l12 12M18 6 6 18" />);

export const CheckCircleIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16 9.5" />
  </>,
);

export const AlertTriangleIcon = createIcon(
  <>
    <path d="M12 3.5 2.5 20h19L12 3.5Z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </>,
);

export const XCircleIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </>,
);

export const InfoIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5v.1" />
  </>,
);

export const DotIcon = createIcon(<circle cx="12" cy="12" r="4" fill="currentColor" />);

export const InboxIcon = createIcon(
  <>
    <path d="M3 13.5 5.5 5h13L21 13.5V19H3v-5.5Z" />
    <path d="M3 13.5h5.5l1 2.5h5l1-2.5H21" />
  </>,
);

export const RefreshIcon = createIcon(
  <>
    <path d="M20 5v5h-5" />
    <path d="M4 19v-5h5" />
    <path d="M19.4 10A8 8 0 0 0 5.2 7.5M4.6 14a8 8 0 0 0 14.2 2.5" />
  </>,
);

export const WifiOffIcon = createIcon(
  <>
    <path d="M3 3l18 18" />
    <path d="M8.5 15.5a5 5 0 0 1 7 0M5 12a10 10 0 0 1 4-2.6M19 12a10 10 0 0 0-5.5-3M2 8.5A15 15 0 0 1 6 5.8M22 8.5A15 15 0 0 0 10 4.1" />
    <path d="M12 19.5v.1" />
  </>,
);

export const CompassIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
  </>,
);

export const ShieldCheckIcon = createIcon(
  <>
    <path d="M12 3 4.5 6v6c0 4.5 3.2 7.5 7.5 9 4.3-1.5 7.5-4.5 7.5-9V6L12 3Z" />
    <path d="m8.8 12 2.3 2.3 4.2-4.6" />
  </>,
);

export const KeyIcon = createIcon(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M14 9l2 2" />
  </>,
);

export const UsersIcon = createIcon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </>,
);

export const ScrollIcon = createIcon(
  <>
    <path d="M6 3h12v15a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1h10v1a3 3 0 0 0 3 3" />
    <path d="M9 8h6M9 12h6" />
  </>,
);

type IconProps = {
  className?: string;
};

function IconFrame({ children, className }: React.PropsWithChildren<IconProps>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19" />
    </IconFrame>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </IconFrame>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13a4 4 0 0 1 0 7.75" />
    </IconFrame>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconFrame>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </IconFrame>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M3 3 21 21" />
      <path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" />
      <path d="M9.4 5.1A10.3 10.3 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-4.1 5.2" />
      <path d="M6.7 6.7A17.7 17.7 0 0 0 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4-.8" />
    </IconFrame>
  );
}

export function RotateIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M21 2v6h-6" />
      <path d="M20 13a8 8 0 1 1-2.34-6.05L21 8" />
    </IconFrame>
  );
}

export function SparklesIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z" />
      <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z" />
      <path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8Z" />
    </IconFrame>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconFrame>
  );
}

export function DoorIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8" />
      <path d="M10 12h11" />
      <path d="m18 8 4 4-4 4" />
      <path d="M9 12h.01" />
    </IconFrame>
  );
}

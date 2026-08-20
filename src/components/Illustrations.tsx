export function FootballIllustration({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="26" />
      <polygon points="32,20 40,26 37,35 27,35 24,26" fill="currentColor" stroke="none" />
      <path d="M32,20 L32,9" />
      <path d="M40,26 L52,18" />
      <path d="M37,35 L44,49" />
      <path d="M27,35 L20,49" />
      <path d="M24,26 L12,18" />
    </svg>
  );
}

export function BrainIllustration({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 14c-6 0-10 4-10 9 0-1-5 1-5 7 0 4 3 6 3 6-2 2-2 6 1 8 2 1.5 4 1 4 1 1 3 4 5 8 5h6c4 0 7-2 8-5 0 0 2 .5 4-1 3-2 3-6 1-8 0 0 3-2 3-6 0-6-5-8-5-7 0-5-4-9-10-9-2 0-4 1-5 2-1-1-3-2-5-2Z" />
      <path d="M32 14v36" />
      <path d="M22 24c2 1 2 4 0 5" />
      <path d="M42 24c-2 1-2 4 0 5" />
      <path d="M24 36c2 1 3 3 2 5" />
      <path d="M40 36c-2 1-3 3-2 5" />
    </svg>
  );
}

export function MicrophoneIllustration({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="24" y="8" width="16" height="28" rx="8" />
      <path d="M24 17h16M24 23h16M24 29h16" strokeWidth="2" />
      <path d="M16 28c0 9 7 16 16 16s16-7 16-16" />
      <path d="M32 44v8" />
      <path d="M24 56h16" />
      <path d="M53 14V6l6-1.5V12" strokeWidth="2.5" />
      <g fill="currentColor" stroke="none">
        <circle cx="50" cy="14" r="3.5" />
        <circle cx="58" cy="11" r="3.5" />
      </g>
    </svg>
  );
}

import type { Locale } from '@/lib/i18n/messages'

export function FlagIcon({
  locale,
  size = 18,
  className = '',
}: {
  locale: Locale | string
  size?: number
  className?: string
}) {
  const code = locale.toLowerCase()
  const clipId = `flag-clip-${code}`

  let content: React.ReactNode = null

  if (code === 'vi') {
    content = (
      <>
        <rect width="32" height="32" fill="#da251d" />
        <polygon
          points="16,6.5 18.9,13.8 26.5,13.8 20.3,18.3 22.7,25.5 16,21 9.3,25.5 11.7,18.3 5.5,13.8 13.1,13.8"
          fill="#ffde00"
        />
      </>
    )
  } else if (code === 'en') {
    content = (
      <>
        <rect width="32" height="32" fill="#b22234" />
        <rect y="4.5" width="32" height="4.5" fill="#ffffff" />
        <rect y="13.5" width="32" height="4.5" fill="#ffffff" />
        <rect y="22.5" width="32" height="4.5" fill="#ffffff" />
        <rect width="15" height="18" fill="#3c3b6e" />
        <circle cx="4" cy="4" r="1.1" fill="#ffffff" />
        <circle cx="8" cy="4" r="1.1" fill="#ffffff" />
        <circle cx="12" cy="4" r="1.1" fill="#ffffff" />
        <circle cx="6" cy="7.5" r="1.1" fill="#ffffff" />
        <circle cx="10" cy="7.5" r="1.1" fill="#ffffff" />
        <circle cx="4" cy="11" r="1.1" fill="#ffffff" />
        <circle cx="8" cy="11" r="1.1" fill="#ffffff" />
        <circle cx="12" cy="11" r="1.1" fill="#ffffff" />
        <circle cx="6" cy="14.5" r="1.1" fill="#ffffff" />
        <circle cx="10" cy="14.5" r="1.1" fill="#ffffff" />
      </>
    )
  } else if (code === 'zh') {
    content = (
      <>
        <rect width="32" height="32" fill="#de2910" />
        {/* Main large star */}
        <polygon
          points="8,4.5 9.4,8.5 13.5,8.5 10.2,10.9 11.5,14.8 8,12.4 4.5,14.8 5.8,10.9 2.5,8.5 6.6,8.5"
          fill="#ffde00"
        />
        {/* 4 small arc stars */}
        <polygon points="16,4 16.7,5.5 18.2,5.5 17,6.4 17.5,7.8 16,6.9 14.5,7.8 15,6.4 13.8,5.5 15.3,5.5" fill="#ffde00" />
        <polygon points="18.5,8 19.2,9.5 20.7,9.5 19.5,10.4 20,11.8 18.5,10.9 17,11.8 17.5,10.4 16.3,9.5 17.8,9.5" fill="#ffde00" />
        <polygon points="18.5,13.5 19.2,15 20.7,15 19.5,15.9 20,17.3 18.5,16.4 17,17.3 17.5,15.9 16.3,15 17.8,15" fill="#ffde00" />
        <polygon points="16,17.5 16.7,19 18.2,19 17,19.9 17.5,21.3 16,20.4 14.5,21.3 15,19.9 13.8,19 15.3,19" fill="#ffde00" />
      </>
    )
  } else if (code === 'ja') {
    content = (
      <>
        <rect width="32" height="32" fill="#ffffff" />
        <circle cx="16" cy="16" r="8" fill="#bc002d" />
      </>
    )
  } else if (code === 'ko') {
    content = (
      <>
        <rect width="32" height="32" fill="#ffffff" />
        <g transform="rotate(-30 16 16)">
          <path d="M 16,9 A 7,7 0 0,1 16,23 A 3.5,3.5 0 0,1 16,16 A 3.5,3.5 0 0,0 16,9" fill="#cd2e3a" />
          <path d="M 16,23 A 7,7 0 0,1 16,9 A 3.5,3.5 0 0,1 16,16 A 3.5,3.5 0 0,0 16,23" fill="#0047a0" />
        </g>
        <rect x="5.5" y="6" width="3.5" height="1.1" transform="rotate(35 7.2 6.5)" fill="#000000" />
        <rect x="23" y="6" width="3.5" height="1.1" transform="rotate(-35 24.7 6.5)" fill="#000000" />
        <rect x="5.5" y="25" width="3.5" height="1.1" transform="rotate(-35 7.2 25.5)" fill="#000000" />
        <rect x="23" y="25" width="3.5" height="1.1" transform="rotate(35 24.7 25.5)" fill="#000000" />
      </>
    )
  } else {
    content = <circle cx="16" cy="16" r="16" fill="currentColor" opacity="0.3" />
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`shrink-0 rounded-full border border-black/15 shadow-2xs dark:border-white/20 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="16" cy="16" r="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{content}</g>
    </svg>
  )
}

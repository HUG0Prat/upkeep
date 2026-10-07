const PATHS = {
  download: 'M12 3v12m0 0-5-5m5 5 5-5M5 21h14',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.9 3.9l1.1-1.4M20 20v-4.5h-4.5',
  search: 'm21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  eyeOff: 'M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.2 6.2C4 7.6 2.6 9.8 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  eye: 'M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  chip: 'M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 5h4v4h-4z',
  box: 'm21 8-9-5-9 5m18 0v8l-9 5m9-13-9 5m0 8-9-5V8m9 13v-8M3 8l9 5',
  cpu: 'M4 6h16v12H4zM8 10h3v4H8zm5 0h3m-3 2h3m-3 2h2',
  windows: 'M3 5.5 10 4.5v7H3zM11 4.3 21 3v8.5H11zM3 12.5h7v7L3 18.5zM11 12.5h10V21l-10-1.3z',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  check: 'm5 12 5 5L20 7',
  x: 'M18 6 6 18M6 6l12 12',
  power: 'M12 2v10m6.4-5.4a9 9 0 1 1-12.8 0',
  shield: 'M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  info: 'M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  pin: 'M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  stop: 'M6 6h12v12H6z',
  terminal: 'M4 5h16v14H4zm3 4 3 3-3 3m5 0h5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

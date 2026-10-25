// The icon artwork, taken from the mockup. Each icon is one inline <svg>, hidden from assistive
// technology: the button that holds it carries the accessible label.

const PATHS = {
  borrow: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  return: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  outOfService: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
  restore: 'M4 12a8 8 0 0114-5.3M20 4v5h-5M20 12a8 8 0 01-14 5.3M4 20v-5h5',
  cross: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4L19 7',
  retry: 'M4 12a8 8 0 0114-5.3M20 4v5h-5',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  loading: 'M12 3v4M12 17v4M3 12h4M17 12h4',
  empty: 'M4 13h5l1 3h4l1-3h5M5 13l2-8h10l2 8v6H5z',
  failure: 'M12 8v5M12 17v.01M10 3L2 18h20L14 3z',
  denied: 'M6 11h12v9H6zM8 11V7a4 4 0 018 0v4',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

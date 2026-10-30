/** Radio-group keyboard pattern: one tab stop (the checked option), arrow keys move and select. */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement); if (i < 0) return;
  e.preventDefault();
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
  items[n].focus(); items[n].click();
}
export const tab = (checked: boolean) => (checked ? 0 : -1);

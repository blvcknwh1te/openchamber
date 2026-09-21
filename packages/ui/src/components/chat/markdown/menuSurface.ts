import { dropdownMenuItemClass, dropdownMenuPopupClass } from '@/components/ui/dropdown-menu.styles';

/**
 * Popup surface and item used by menus rendered inside markdown content (table
 * actions) and by the transcript's own menus (file links). They match the app's
 * DropdownMenu look, so an in-content menu is visually indistinguishable from a
 * regular one.
 */

export const createMenuSurface = (): HTMLDivElement => {
  const menu = document.createElement('div');
  menu.className = `hidden ${dropdownMenuPopupClass}`;
  menu.style.backgroundColor = 'var(--surface-elevated)';
  menu.style.color = 'var(--surface-elevated-foreground)';
  return menu;
};

export const createMenuItem = (label: string, action: string | null): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `w-full text-left ${dropdownMenuItemClass}`;
  if (action) {
    button.setAttribute('data-md-action', action);
  }
  button.textContent = label;
  return button;
};

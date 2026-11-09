import { tokens } from './tokens';

export function appendExtensionMarker(element: HTMLElement, surface: 'light' | 'dark'): void {
  const label = 'KLAS Helper+ 기능';
  const marker = document.createElement('sup');
  marker.textContent = '+';
  marker.title = label;
  marker.setAttribute('aria-hidden', 'true');
  marker.style.color = tokens.color[surface === 'dark' ? 'marker-on-dark' : 'marker-on-light'];

  const description = document.createElement('span');
  description.className = 'khp-marker-description';
  description.textContent = label;
  element.append(marker, description);
}

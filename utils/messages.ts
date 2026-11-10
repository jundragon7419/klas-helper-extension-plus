// content script와 background가 주고받는 요청 메시지

export type ExtensionMessage = { type: 'klas/opened' };
export type TabMessage = { type: 'session/extend' };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'klas/opened'
  );
}

export function isTabMessage(value: unknown): value is TabMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'session/extend'
  );
}

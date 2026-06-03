/**
 * 탭 간 통신용 초간단 모듈 스토어.
 * - Crosswalks 탭에서 항목을 탭 → `setMapTarget(lat, lng)` + router 로 Map 탭 이동.
 * - KakaoMap 이 구독해서 target 이 바뀌면 `window.centerMap(lat, lng)` 호출.
 *
 * react-native 환경이므로 EventEmitter 류는 피하고 가장 단순한 콜백 셋으로 구현.
 */
type Target = { lat: number; lng: number; nonce: number };

let current: Target | null = null;
const listeners = new Set<(t: Target) => void>();

export function setMapTarget(lat: number, lng: number): void {
  // nonce 로 같은 좌표 재선택 시에도 구독자가 다시 fire 받도록 보장.
  current = { lat, lng, nonce: (current?.nonce ?? 0) + 1 };
  listeners.forEach((fn) => fn(current!));
}

export function subscribeMapTarget(fn: (t: Target) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function consumeMapTarget(): Target | null {
  const t = current;
  current = null;
  return t;
}

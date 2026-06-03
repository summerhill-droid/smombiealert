/**
 * 횡단보도 표시 이름 정규화 유틸.
 *
 * 데이터의 `교차로명` 필드는 종종 부가 정보가 괄호로 따라온다.
 *   예) `석탑프라자(경보)` → `석탑프라자`
 *
 * 지도 라벨 / 팝업 / 리스트 표시 / 검색 매칭 등 모든 경로에서 동일한 규칙으로
 * 정리하기 위해 한 곳에 모아둔다.
 */
export function stripParens(s: string | null | undefined): string {
  if (!s) return "";
  // 중첩되지 않은 한 쌍의 괄호를 반복 제거 (전각 괄호 포함)
  return s
    .replace(/\s*[\(（][^)）]*[\)）]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

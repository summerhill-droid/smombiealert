import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useSmartAlert } from "@/hooks/useSmartAlert";

type RowProps = {
  label: string;
  value?: string | number | null;
  valueColor?: string;
  small?: boolean;
};

type ChipProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color?: string;
};

function StatusRow({ label, value, valueColor, small }: RowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>

      <Text
        style={[
          styles.rowValue,
          small ? styles.rowValueSmall : null,
          valueColor ? { color: valueColor } : null,
        ]}
        numberOfLines={small ? 4 : 2}
      >
        {value ?? "-"}
      </Text>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function ReasonRow({ value }: { value?: string | null }) {
  return (
    <View style={styles.reasonRow}>
      <Text style={styles.reasonLabel}>판단 이유</Text>
      <Text style={styles.reasonValue}>{value ?? "-"}</Text>
    </View>
  );
}

function StatusChip({ icon, label, color = "#CBD5E1" }: ChipProps) {
  return (
    <View style={styles.chip}>
      <Feather name={icon} size={11} color={color} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function getBehaviorLabelKo(behavior?: string) {
  switch (behavior) {
    case "Still":
      return "정지";
    case "Baseline":
      return "일반 보행";
    case "Navigation":
      return "지도 사용";
    case "Watching":
      return "영상 시청";
    case "Typing":
      return "타이핑";
    default:
      return behavior ?? "-";
  }
}

function getSignalLabel(signal?: string | null) {
  if (!signal) return "신호 확인 중";

  const raw = String(signal).toLowerCase();

  if (
    raw.includes("protected-movement-allowed") ||
    raw.includes("protected-to-allowed") ||
    raw.includes("protected-movement")
  ) {
    return "보행 가능";
  }

  if (
    raw.includes("permissive-movement-allowed") ||
    raw.includes("permissive-movement")
  ) {
    return "우회전 주의";
  }

  if (raw.includes("protected-clearance")) {
    return "신호 종료 중";
  }

  if (raw.includes("permissive-clearance")) {
    return "종료·우회전 주의";
  }

  if (raw.includes("stop-and-remain") || raw === "red") {
    return "적색 신호";
  }

  if (raw.includes("dark")) {
    return "신호 없음";
  }

  if (raw === "green") {
    return "보행 가능";
  }

  if (raw === "yellow") {
    return "신호 종료 중";
  }

  if (raw.includes("unknown")) {
    return "신호 확인 중";
  }

  return String(signal);
}

function getDistanceLabel(distanceM?: number) {
  if (distanceM == null || !Number.isFinite(distanceM)) return "확인 중";
  if (distanceM <= 10) return "10m 이내";
  if (distanceM <= 30) return "10~30m";
  return "30m 밖";
}

function getApiLabel(source?: string, error?: string) {
  if (error) return "센서 확인 중";
  if (source === "real-api") return "실시간 분석";
  if (source === "mock-api") return "테스트 분석";
  if (source === "fallback") return "기본값";
  return "확인 중";
}

function getApiChipColor(source?: string, error?: string) {
  if (error) return "#FBBF24";
  if (source === "real-api") return "#93C5FD";
  if (source === "mock-api") return "#FBBF24";
  return "#CBD5E1";
}

function getSensorLabel(ready?: boolean, count?: number) {
  if (ready === true) return "센서 ready";
  if (ready === false) return `센서 ${count ?? 0}개`;
  return "센서 확인";
}

function getLevelTheme(level?: string) {
  switch (level) {
    case "주의":
      return {
        title: "주의 모니터링",
        subtitle: "횡단보도 접근 상황",
        bg: "rgba(92, 63, 9, 0.94)",
        accent: "#FBBF24",
        badgeBg: "rgba(251,191,36,0.16)",
        badgeBorder: "rgba(251,191,36,0.55)",
        badgeText: "#FDE68A",
        icon: "alert-circle" as const,
      };

    case "경고":
      return {
        title: "경고 상황 감지",
        subtitle: "스마트폰 사용 주의 필요",
        bg: "rgba(92, 43, 16, 0.95)",
        accent: "#FB923C",
        badgeBg: "rgba(251,146,60,0.17)",
        badgeBorder: "rgba(251,146,60,0.6)",
        badgeText: "#FDBA74",
        icon: "alert-triangle" as const,
      };

    case "위험":
      return {
        title: "위험 알림",
        subtitle: "즉시 전방 확인 필요",
        bg: "rgba(86, 21, 28, 0.96)",
        accent: "#EF4444",
        badgeBg: "rgba(239,68,68,0.17)",
        badgeBorder: "rgba(239,68,68,0.65)",
        badgeText: "#FCA5A5",
        icon: "alert-octagon" as const,
      };

    case "OFF":
    default:
      return {
        title: "보행 안전 모니터",
        subtitle: "현재 위험 알림 없음",
        bg: "rgba(8, 18, 38, 0.94)",
        accent: "#60A5FA",
        badgeBg: "rgba(255,255,255,0.10)",
        badgeBorder: "rgba(255,255,255,0.15)",
        badgeText: "#E5E7EB",
        icon: "shield" as const,
      };
  }
}

export function StatusHeader() {
  const alert = useSmartAlert();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);

  const theme = useMemo(() => getLevelTheme(alert.level), [alert.level]);

  const distanceText =
    alert.distanceM != null && Number.isFinite(alert.distanceM)
      ? `${Math.round(alert.distanceM)}m`
      : "확인 중";

  const distanceZoneText = getDistanceLabel(alert.distanceM);
  const behaviorText = getBehaviorLabelKo(alert.behavior);
  const signalText = getSignalLabel(alert.signalState);
  const apiText = getApiLabel(alert.behaviorApiSource, alert.behaviorApiError);

  const crosswalkText = alert.crosswalkName
    ? `${alert.crosswalkName} · ${distanceText}`
    : `가까운 횡단보도 확인 중 · ${distanceText}`;

  const remainingText =
    alert.remainingSec != null && Number.isFinite(alert.remainingSec)
      ? `${Math.max(0, Math.round(alert.remainingSec))}초`
      : "없음";

  const sensorWindowText =
    alert.sensorWindowReady === true
      ? `ready · ${alert.sensorWindowSampleCount ?? 0}개`
      : alert.sensorWindowReady === false
        ? `수집 중 · ${alert.sensorWindowSampleCount ?? 0}개`
        : "확인 중";

  const sensorChipText = getSensorLabel(
    alert.sensorWindowReady,
    alert.sensorWindowSampleCount,
  );

  const messageText = alert.message ?? "현재 위험 알림 없음";

  const summaryMain = `${distanceText} · ${behaviorText}`;

  return (
    <View
      style={[
        styles.wrapper,
        {
          top: insets.top - 6,
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={[
          styles.card,
          {
            backgroundColor: theme.bg,
          },
        ]}
      >
        <View
          style={[
            styles.accentGlow,
            {
              backgroundColor: theme.accent,
            },
          ]}
        />

        <View style={styles.headerTop}>
          <View style={styles.leftGroup}>
            <View
              style={[
                styles.iconWrap,
                {
                  borderColor: theme.accent,
                  backgroundColor: `${theme.accent}1F`,
                },
              ]}
            >
              <Feather name={theme.icon} size={17} color={theme.accent} />
            </View>

            <View style={styles.titleWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {theme.title}
              </Text>

              <Text style={styles.subtitle} numberOfLines={1}>
                {theme.subtitle}
              </Text>
            </View>
          </View>

          <View style={styles.rightGroup}>
            <View
              style={[
                styles.levelBadge,
                {
                  backgroundColor: theme.badgeBg,
                  borderColor: theme.badgeBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.levelBadgeText,
                  {
                    color: theme.badgeText,
                  },
                ]}
              >
                {alert.level ?? "OFF"}
              </Text>
            </View>

            <Feather
              name={expanded ? "chevron-up" : "chevron-down"}
              size={17}
              color="#E5E7EB"
            />
          </View>
        </View>

        <View style={styles.heroBlock}>
          <Text style={styles.heroMeta} numberOfLines={1}>
            {summaryMain}
          </Text>

          <Text style={styles.heroMessage} numberOfLines={2}>
            {messageText}
          </Text>
        </View>

        <View style={styles.chipRow}>
          <StatusChip
            icon="activity"
            label={apiText}
            color={getApiChipColor(alert.behaviorApiSource, alert.behaviorApiError)}
          />

          <StatusChip
            icon="radio"
            label={signalText}
            color={
              signalText.includes("적색")
                ? "#FCA5A5"
                : signalText.includes("우회전")
                  ? "#FDBA74"
                  : signalText.includes("보행 가능")
                    ? "#86EFAC"
                    : "#CBD5E1"
            }
          />

          <StatusChip
            icon="cpu"
            label={sensorChipText}
            color={alert.sensorWindowReady ? "#A7F3D0" : "#CBD5E1"}
          />
        </View>

        <View style={styles.locationLine}>
          <Feather name="map-pin" size={11} color="#CBD5E1" />

          <Text style={styles.locationText} numberOfLines={1}>
            {crosswalkText}
          </Text>
        </View>

        {expanded && (
          <View style={styles.detailSection}>
            <SectionTitle title="현재 판단" />

            <StatusRow
              label="알림 단계"
              value={alert.level}
              valueColor={theme.accent}
            />

            <StatusRow label="알림 메시지" value={messageText} small />

            <ReasonRow value={alert.reason ?? "-"} />

            <SectionTitle title="입력 정보" />

            <StatusRow label="가까운 횡단보도" value={crosswalkText} />

            <StatusRow label="거리구간" value={distanceZoneText} />

            <StatusRow
              label="행동"
              value={`${behaviorText} (${alert.behavior})`}
            />

            <StatusRow label="V2X" value={signalText} />

            <StatusRow label="잔여초" value={remainingText} />

            <SectionTitle title="시스템 상태" />

            <StatusRow
              label="행동 API"
              value={
                alert.behaviorApiError
                  ? `센서 확인 중 · ${alert.behaviorApiError}`
                  : `${alert.behaviorApiSource ?? "확인 중"}${
                      alert.behaviorApiLoading ? " · 호출 중" : ""
                    }`
              }
            />

            <StatusRow label="센서 window" value={sensorWindowText} />

            <StatusRow
              label="방향오차"
              value={
                alert.angleError != null
                  ? `${Math.round(alert.angleError)}°`
                  : "매칭 없음"
              }
            />

            <StatusRow
              label="횡단보도 선택"
              value={
                alert.crosswalkSelectionReason === "heading"
                  ? "진행방향 기반 선택"
                  : alert.crosswalkSelectionReason === "nearest"
                    ? "가장 가까운 횡단보도"
                    : "-"
              }
            />

            <StatusRow
              label="연동 교차로"
              value={alert.intersectionName ?? "-"}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 14,
    right: 14,
    zIndex: 100,
    elevation: 100,
  },

  card: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10,
    },
  },

  accentGlow: {
    position: "absolute",
    left: -40,
    top: -50,
    width: 130,
    height: 130,
    borderRadius: 65,
    opacity: 0.13,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  leftGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
  },

  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.3,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  titleWrap: {
    flex: 1,
  },

  title: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.35,
  },

  subtitle: {
    color: "#CBD5E1",
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 2,
  },

  rightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  levelBadge: {
    minWidth: 60,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  levelBadgeText: {
    fontSize: 13.5,
    fontWeight: "900",
  },

  heroBlock: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  heroMeta: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },

  heroMessage: {
    color: "#FFFFFF",
    fontSize: 14.2,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: -0.15,
  },

  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 9,
  },

  chip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  chipText: {
    fontSize: 10,
    fontWeight: "800",
  },

  locationLine: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 5,
  },

  locationText: {
    flex: 1,
    color: "#E2E8F0",
    fontSize: 10.5,
    fontWeight: "700",
  },

  detailSection: {
    marginTop: 11,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    paddingTop: 4,
  },

  sectionTitleWrap: {
    paddingTop: 10,
    paddingBottom: 4,
  },

  sectionTitle: {
    color: "#60A5FA",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: -0.1,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },

  rowLabel: {
    flex: 0.9,
    color: "#AAB4C2",
    fontSize: 11,
    fontWeight: "800",
    paddingRight: 8,
  },

  rowValue: {
    flex: 1.25,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    lineHeight: 16,
  },

  rowValueSmall: {
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: "700",
  },

  reasonRow: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.065)",
  },

  reasonLabel: {
    color: "#9CA3AF",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 4,
  },

  reasonValue: {
    color: "#F9FAFB",
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: "700",
  },
});
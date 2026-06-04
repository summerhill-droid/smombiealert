import { Feather } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useProtection } from "@/contexts/ProtectionContext";
import {
  useNearbyCsvCrosswalks,
  type NearbyCsvCrosswalk,
} from "@/hooks/useNearbyCsvCrosswalks";
import { stripParens } from "@/lib/crosswalkName";
import { setMapTarget } from "@/lib/mapTarget";

function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export default function CrosswalksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { position, hasFix } = useProtection();

  const all = useNearbyCsvCrosswalks(hasFix ? position : null, null, 10_000);
  const [query, setQuery] = useState("");

  // 검색: `주소` + 괄호 제거된 `교차로명` 양쪽에 대해 부분일치(대소문자 무시).
  // 한글에는 대소문자 개념이 없지만 영문/기호 검색을 위해 lowerCase 정규화 유지.
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return all;
    return all.filter((item) => {
      const name = stripParens(item.intersection).toLocaleLowerCase();
      const addr = (item.address || "").toLocaleLowerCase();
      return name.includes(q) || addr.includes(q);
    });
  }, [all, query]);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 16) : insets.top + 8;

  const handlePress = (item: NearbyCsvCrosswalk) => {
    setMapTarget(item.lat, item.lng);
    router.navigate("/(tabs)");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>전체 횡단보도</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          가까운 순으로 정렬 · 10초마다 갱신 · 총 {all.length.toLocaleString()}개
        </Text>

        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
            },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="주소 또는 교차로명 검색"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery("")}
              hitSlop={10}
              accessibilityLabel="검색어 지우기"
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!hasFix ? (
        <EmptyState
          colors={colors}
          icon="navigation"
          title="위치 확인 중…"
          subtitle="GPS 신호를 잡고 있어요"
        />
      ) : all.length === 0 ? (
        <EmptyState
          colors={colors}
          icon="alert-circle"
          title="횡단보도 데이터가 없습니다"
          subtitle="CSV 로드를 확인하세요"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          colors={colors}
          icon="search"
          title="검색 결과가 없습니다"
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 24 }}
          initialNumToRender={20}
          windowSize={10}
          maxToRenderPerBatch={20}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <CrosswalkRow item={item} onPress={() => handlePress(item)} />
          )}
        />
      )}
    </View>
  );
}

function CrosswalkRow({
  item,
  onPress,
}: {
  item: NearbyCsvCrosswalk;
  onPress: () => void;
}) {
  const colors = useColors();
  const cleanIntersection = stripParens(item.intersection);
  const hasIntersection = !!cleanIntersection;
  const hasAddress = !!item.address;
  const primary = hasIntersection
    ? cleanIntersection
    : hasAddress
    ? item.address
    : `ID ${item.id}`;
  const secondary = hasIntersection && hasAddress ? item.address : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
          backgroundColor: pressed ? "rgba(255,255,255,0.04)" : "transparent",
        },
      ]}
    >
      <View style={styles.distCol}>
        <Feather name="map-pin" size={14} color={colors.accent} />
        <Text style={[styles.dist, { color: colors.foreground }]}>
          {formatDistance(item.distance)}
        </Text>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={[styles.primary, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {primary}
        </Text>
        {secondary ? (
          <Text
            style={[styles.secondary, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {secondary}
          </Text>
        ) : null}
        {item.gu ? (
          <View style={styles.metaRow}>
            <View style={[styles.guPill, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.guText, { color: colors.foreground }]}>
                {item.gu}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function EmptyState({
  colors,
  icon,
  title,
  subtitle,
  tint,
}: {
  colors: ReturnType<typeof useColors>;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  tint?: string;
}) {
  return (
    <View style={styles.emptyWrap}>
      <View
        style={[
          styles.emptyIcon,
          {
            borderColor: tint ?? colors.border,
            backgroundColor: (tint ?? colors.mutedForeground) + "1F",
          },
        ]}
      >
        <Feather name={icon} size={28} color={tint ?? colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    padding: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  distCol: {
    width: 64,
    alignItems: "center",
    gap: 2,
  },
  dist: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  primary: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    lineHeight: 19,
  },
  secondary: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 2,
  },
  guPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  guText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  emptySub: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
});

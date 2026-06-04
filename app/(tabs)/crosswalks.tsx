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
import { useProtection } from "@/context/ProtectionContext";
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

  // 寃?? `二쇱냼` + 愿꾪샇 ?쒓굅??`援먯감濡쒕챸` ?묒そ?????遺遺꾩씪移???뚮Ц??臾댁떆).
  // ?쒓??먮뒗 ??뚮Ц??媛쒕뀗???놁?留??곷Ц/湲고샇 寃?됱쓣 ?꾪빐 lowerCase ?뺢퇋???좎?.
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
        <Text style={[styles.title, { color: colors.foreground }]}>?꾩껜 ?〓떒蹂대룄</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          媛源뚯슫 ?쒖쑝濡??뺣젹 쨌 10珥덈쭏??媛깆떊 쨌 珥?{all.length.toLocaleString()}媛?
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
            placeholder="二쇱냼 ?먮뒗 援먯감濡쒕챸 寃??
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
              accessibilityLabel="寃?됱뼱 吏?곌린"
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
          title="?꾩튂 ?뺤씤 以묅?
          subtitle="GPS ?좏샇瑜??↔퀬 ?덉뼱??
        />
      ) : all.length === 0 ? (
        <EmptyState
          colors={colors}
          icon="alert-circle"
          title="?〓떒蹂대룄 ?곗씠?곌? ?놁뒿?덈떎"
          subtitle="CSV 濡쒕뱶瑜??뺤씤?섏꽭??
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          colors={colors}
          icon="search"
          title="寃??寃곌낵媛 ?놁뒿?덈떎"
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

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Check, Cpu, Download, ShieldCheck, Trash2, X } from "lucide-react-native";
import { Button } from "../ui/Button";
import { colors, hitSlop, radius, typography } from "../../lib/theme";
import { usePrivacyMode, useSelectedModelId } from "../../lib/inference/privacy-mode";
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  ensureSelectionFromCatalog,
  refreshCatalogNow,
  setStubMode,
  subscribeManager,
  type ManagerState,
  type ModelCatalogEntry,
  type PerModelState
} from "../../lib/inference/local/model-manager";
import { GEMMA_NATIVE_AVAILABLE } from "../../lib/inference/local/gemma-native";

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function tierLabel(tier: string): { text: string; tone: "info" | "ready" | "warn" } {
  switch (tier) {
    case "light":
      return { text: "轻量", tone: "ready" };
    case "medium":
      return { text: "中等", tone: "info" };
    case "full":
      return { text: "完整", tone: "warn" };
    default:
      return { text: tier || "未分类", tone: "info" };
  }
}

function toneStyle(tone: "info" | "ready" | "warn" | "error") {
  switch (tone) {
    case "ready":
      return { color: colors.status.calm };
    case "warn":
      return { color: colors.status.watch };
    case "error":
      return { color: colors.status.alert };
    default:
      return { color: colors.status.info };
  }
}

function statusLabel(per: PerModelState | undefined): { text: string; tone: "info" | "ready" | "warn" | "error" } {
  if (!per) return { text: "未检查", tone: "info" };
  switch (per.status) {
    case "ready":
      return { text: "已就绪", tone: "ready" };
    case "downloading":
      return { text: "下载中", tone: "info" };
    case "checking":
      return { text: "检查中…", tone: "info" };
    case "absent":
      return { text: "未下载", tone: "warn" };
    case "error":
      return { text: "出错", tone: "error" };
    case "unsupported":
      return { text: "平台不支持", tone: "warn" };
    default:
      return { text: "未知", tone: "warn" };
  }
}

export function PrivacyModeCard() {
  const [privacyOn, setPrivacy] = usePrivacyMode();
  const [selectedId, setSelectedId] = useSelectedModelId();
  const [manager, setManager] = useState<ManagerState>({ stub: false, byModel: {}, selectedModelId: null });
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const localInferenceAvailable = GEMMA_NATIVE_AVAILABLE;
  const visiblePrivacyOn = localInferenceAvailable ? privacyOn : false;
  const unsupportedPlatformLabel = Platform.OS === "ios" ? "iPhone" : Platform.OS === "web" ? "Web" : "当前平台";
  const localSubtitle =
    Platform.OS === "ios"
      ? "开启后优先使用 iPhone 本地 GGUF 模型处理文字照护记录；语音暂不走本地模型。"
      : "开启后优先使用已下载的本地文字模型处理照护记录；语音暂不走本地模型。";

  useEffect(() => subscribeManager(setManager), []);

  const reloadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const list = await refreshCatalogNow();
      setCatalog(list);
      await ensureSelectionFromCatalog(list);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const showBanner =
    localInferenceAvailable &&
    privacyOn &&
    selectedId !== null &&
    (manager.byModel[selectedId]?.status !== "ready") &&
    manager.byModel[selectedId]?.status !== "unsupported";

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <ShieldCheck color={colors.brand.primary} size={20} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>隐私模式</Text>
          <Text style={styles.subtitle}>
            {localInferenceAvailable
              ? localSubtitle
              : `${unsupportedPlatformLabel} 端支持完整 App 与云端 Agent 工作流；本地推理需要安装包含 CareMind Native Module 的开发包或真机包。`}
          </Text>
        </View>
        <Switch
          value={visiblePrivacyOn}
          disabled={!localInferenceAvailable}
          onValueChange={(value) => {
            if (!localInferenceAvailable) return;
            void setPrivacy(value);
          }}
          trackColor={{ false: colors.border.subtle, true: colors.brand.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      {showBanner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            当前选中的模型尚未就绪。隐私模式下文字请求不会自动上传云端；请先下载并选择本地模型，或关闭隐私模式后使用云端整理。
          </Text>
        </View>
      ) : null}

      {!GEMMA_NATIVE_AVAILABLE ? (
        <Text style={styles.helper}>
          {unsupportedPlatformLabel} 端可以使用智能记录、今日照护、复诊准备、资料上传和语音录音上传转写；如需端侧隐私模式，请使用包含 CareMind iOS/Android Native Module 的构建包。
        </Text>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>选择本地模型</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新模型列表"
              hitSlop={hitSlop}
              onPress={() => void reloadCatalog()}
              style={styles.refreshButton}
            >
              <Text style={styles.refreshText}>{catalogLoading ? "刷新中…" : "刷新"}</Text>
            </Pressable>
          </View>

          {catalogError ? (
            <Text style={styles.errorText}>无法获取模型列表：{catalogError}</Text>
          ) : null}

          {catalogLoading && catalog.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.brand.primary} />
              <Text style={styles.helper}>正在加载模型目录…</Text>
            </View>
          ) : null}

          {!catalogLoading && catalog.length === 0 && !catalogError ? (
            <Text style={styles.helper}>后端尚未配置任何本地模型文件。</Text>
          ) : null}

          {catalog.map((entry) => {
            const per = manager.byModel[entry.id];
            const status = statusLabel(per);
            const tier = tierLabel(entry.tier);
            const isSelected = selectedId === entry.id;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`选择模型 ${entry.display_name}`}
                onPress={() => void setSelectedId(entry.id)}
                style={[styles.modelRow, isSelected && styles.modelRowSelected]}
              >
                <View style={styles.modelRadio}>
                  {isSelected ? <Check color={colors.brand.primary} size={18} /> : null}
                </View>
                <View style={styles.modelInfo}>
                  <View style={styles.modelHeader}>
                    <Text style={styles.modelName}>{entry.display_name}</Text>
                    <View style={[styles.tierPill, toneBackground(tier.tone)]}>
                      <Text style={[styles.tierText, toneStyle(tier.tone)]}>{tier.text}</Text>
                    </View>
                  </View>
                  <Text style={styles.modelDescription} numberOfLines={3}>
                    {entry.description || `${formatBytes(entry.size_bytes)} · ${entry.format}`}
                  </Text>
                  <View style={styles.modelMetaRow}>
                    <Text style={styles.modelSize}>{formatBytes(entry.size_bytes)}</Text>
                    <Text style={[styles.modelStatus, toneStyle(status.tone)]}>{status.text}</Text>
                  </View>
                  {per?.status === "downloading" ? (
                    <View style={styles.progressBar}>
                      <View
                        style={[styles.progressFill, { width: `${Math.max(2, Math.round(per.progress * 100))}%` }]}
                      />
                    </View>
                  ) : null}
                  {per?.errorMessage ? (
                    <Text style={styles.errorText} numberOfLines={3}>
                      {per.errorMessage}
                    </Text>
                  ) : null}
                  <View style={styles.actionRow}>
                    {per?.status === "downloading" ? (
                      <Button
                        label="取消"
                        variant="ghost"
                        icon={<X color={colors.text.secondary} size={16} />}
                        onPress={() => void cancelDownload(entry.id)}
                      />
                    ) : per?.status === "ready" ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`删除模型 ${entry.display_name}`}
                        hitSlop={hitSlop}
                        style={styles.deleteButton}
                        onPress={() => void deleteModel(entry.id)}
                      >
                        <Trash2 color={colors.status.alert} size={16} />
                        <Text style={styles.deleteText}>删除</Text>
                      </Pressable>
                    ) : (
                      <Button
                        label={per?.status === "error" ? "重新下载" : "下载"}
                        variant="primary"
                        icon={<Download color="#FFFFFF" size={16} />}
                        onPress={() => void downloadModel(entry.id)}
                      />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}

          {__DEV__ ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={manager.stub ? "关闭本地桩模式" : "启用本地桩模式（开发用）"}
              hitSlop={hitSlop}
              onPress={() => void setStubMode(!manager.stub)}
              style={styles.devToggle}
            >
              <Cpu color={colors.text.secondary} size={14} />
              <Text style={styles.devText}>
                {manager.stub ? "桩模式已开启（点此关闭）" : "启用本地桩模式（开发用，无需真实模型）"}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function toneBackground(tone: "info" | "ready" | "warn" | "error") {
  switch (tone) {
    case "ready":
      return { backgroundColor: colors.statusSoft.calm };
    case "warn":
      return { backgroundColor: colors.statusSoft.watch };
    case "error":
      return { backgroundColor: colors.statusSoft.alert };
    default:
      return { backgroundColor: colors.statusSoft.info };
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 15,
    marginBottom: 12,
    gap: 12
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center",
    justifyContent: "center"
  },
  headerText: {
    flex: 1
  },
  title: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  subtitle: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 4
  },
  banner: {
    backgroundColor: "#FFF3D6",
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: "#F1D78B"
  },
  bannerText: {
    ...typography.helper,
    color: "#7A5A00"
  },
  helper: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 4
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4
  },
  sectionTitle: {
    ...typography.label,
    color: colors.text.primary
  },
  refreshButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.muted
  },
  refreshText: {
    ...typography.small,
    color: colors.text.secondary,
    fontWeight: "700"
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: 12,
    backgroundColor: colors.surface.card
  },
  modelRowSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primarySoft
  },
  modelRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.brand.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2
  },
  modelInfo: {
    flex: 1,
    gap: 6
  },
  modelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  modelName: {
    ...typography.label,
    color: colors.text.primary,
    flexShrink: 1
  },
  tierPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999
  },
  tierText: {
    ...typography.small,
    fontWeight: "700"
  },
  modelDescription: {
    ...typography.small,
    color: colors.text.secondary
  },
  modelMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  modelSize: {
    ...typography.small,
    color: colors.text.muted
  },
  modelStatus: {
    ...typography.small,
    fontWeight: "700"
  },
  errorText: {
    ...typography.small,
    color: colors.status.alert
  },
  progressBar: {
    height: 5,
    borderRadius: 5,
    backgroundColor: colors.surface.muted,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.brand.primary
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface.muted
  },
  deleteText: {
    ...typography.small,
    color: colors.status.alert,
    fontWeight: "700"
  },
  devToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.muted
  },
  devText: {
    ...typography.small,
    color: colors.text.secondary
  }
});

// Unused import kept for lint hygiene (ScrollView may be added later for very long catalogs).
void ScrollView;

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  Check,
  ClipboardCheck,
  Download,
  FileText,
  ListChecks,
  Stethoscope
} from "lucide-react-native";
import type { AttentionItem, MemoryItem } from "../../types/caremind";
import { useCareMind } from "../../lib/caremind-store";
import { colors, hitSlop, typography } from "../../lib/theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Pill } from "../ui/Pill";
import { Screen } from "../ui/Screen";
import { SectionTitle } from "../ui/SectionTitle";
import { MemoryUsedPill } from "../memory/MemoryUsedPill";

type Range = "7d" | "30d" | "custom";

const materials = ["近期用药清单", "近 7 天照护摘要", "MRI / CT 检查报告", "认知量表结果", "想问医生的问题"];

const metricToneStyles = {
  brand: {
    backgroundColor: colors.statusSoft.calm,
    borderColor: "#B8E6D4"
  },
  watch: {
    backgroundColor: colors.statusSoft.watch,
    borderColor: "#F4D18A"
  },
  alert: {
    backgroundColor: colors.statusSoft.alert,
    borderColor: "#F1B8A9"
  },
  info: {
    backgroundColor: colors.statusSoft.info,
    borderColor: "#BFDDF3"
  }
};

function buildDoctorQuestions(items: AttentionItem[]) {
  const questions = items.flatMap((item) => {
    if (item.type === "night_safety") {
      return ["近期夜间起床或开门外出相关变化，是否需要进一步评估原因？"];
    }
    if (item.type === "nutrition") {
      return ["近期进食、饮水或呛咳变化，是否需要营养或吞咽相关评估？"];
    }
    if (item.type === "medication") {
      return ["拒药、漏药或服药困难持续出现时，是否需要调整服药支持方式？"];
    }
    if (item.type === "caregiver") {
      return ["家属长期睡眠不足或照护压力较高，是否有社区照护或喘息服务建议？"];
    }
    return [];
  });

  return Array.from(new Set([...questions, "复诊时是否需要携带 MRI/CT、认知量表或当前用药清单？"]));
}

function buildSummaryBullets(items: AttentionItem[]) {
  if (items.length === 0) {
    return ["暂无明确关注事项记录。"];
  }

  return items.map((item) => `${item.title}：${item.evidence}`);
}

function RangeSelector({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  const options: { label: string; value: Range }[] = [
    { label: "近 7 天", value: "7d" },
    { label: "近 30 天", value: "30d" },
    { label: "自定义", value: "custom" }
  ];

  return (
    <View style={styles.segmented}>
      {options.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="button"
          accessibilityState={{ selected: range === item.value }}
          hitSlop={hitSlop}
          onPress={() => onChange(item.value)}
          style={[styles.segment, range === item.value && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, range === item.value && styles.segmentTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ProgressCard({ recordCount }: { recordCount: number }) {
  const progress = Math.min(recordCount / 3, 1);
  const title =
    recordCount === 0
      ? "记录满 3 天后，我会帮你整理复诊材料"
      : recordCount < 3
        ? `还差 ${3 - recordCount} 条记录可生成早期摘要`
        : recordCount < 7
          ? "早期照护摘要已可生成"
          : "完整 7 天摘要已可生成";
  const body =
    recordCount === 0
      ? "先去智能记录保存第一条照护记录，复诊准备会自动累积材料。"
      : recordCount < 3
        ? "记录越连续，医生越容易看到变化趋势。"
        : recordCount < 7
          ? "当前数据仍在积累，摘要会标注为早期参考。"
          : "你已经有足够的连续记录，可以导出更完整的复诊摘要。";

  return (
    <Card tone={recordCount > 0 ? "brand" : "info"}>
      <View style={styles.headerRow}>
        <FileText color={recordCount > 0 ? colors.brand.primaryDark : colors.status.info} size={21} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      {recordCount === 0 ? (
        <View style={styles.progressAction}>
          <Button label="去记录今天" onPress={() => router.push("/(tabs)/log")} />
        </View>
      ) : null}
    </Card>
  );
}

function MetricsGrid({ metrics }: { metrics: ReturnType<typeof useCareMind>["followupMetrics"] }) {
  return (
    <View style={styles.metricsGrid}>
      {metrics.map((metric) => (
        <View key={metric.label} style={[styles.metricSurface, metricToneStyles[metric.tone]]}>
          <Text style={styles.metricValue}>{metric.value}</Text>
          <Text style={styles.metricLabel}>{metric.label}</Text>
          <Text style={styles.metricHelper}>{metric.helper}</Text>
        </View>
      ))}
    </View>
  );
}

function ClinicalSummarySheet({ recordCount, attentionItems }: { recordCount: number; attentionItems: AttentionItem[] }) {
  const summaryBullets = buildSummaryBullets(attentionItems);

  return (
    <Card>
      <View style={styles.reportHeader}>
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle}>照护摘要报告</Text>
          <Text style={styles.reportSubtitle}>家属记录整理 · 不包含医生诊断</Text>
        </View>
        <Pill label={recordCount >= 7 ? "CareMind" : "数据积累中"} tone={recordCount >= 7 ? "brand" : "watch"} />
      </View>
      <View style={styles.rule} />
      <Text style={styles.reportSectionTitle}>一、照护记录概况</Text>
      <Text style={styles.reportBullet}>- 已保存 {recordCount} 条家庭照护记录。</Text>
      <Text style={styles.reportBullet}>- 以下内容来自家属自行输入、保存和确认的照护记录。</Text>

      <Text style={styles.reportSectionTitle}>二、主要变化摘要</Text>
      {summaryBullets.map((bullet) => (
        <Text key={bullet} style={styles.reportBullet}>
          - {bullet}
        </Text>
      ))}
    </Card>
  );
}

function TriedStrategiesCard({ confirmedMemories }: { confirmedMemories: MemoryItem[] }) {
  const strategy = confirmedMemories.find((item) => item.type === "effective_strategy");
  if (!strategy) {
    return null;
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <ClipboardCheck color={colors.brand.primaryDark} size={21} />
        <Text style={styles.cardTitle}>已尝试方法</Text>
      </View>
      <View style={styles.strategyGroup}>
        <Text style={styles.strategyTitle}>可能有帮助</Text>
        <Text style={styles.body}>- {strategy.title}</Text>
        <Text style={styles.body}>{strategy.description}</Text>
      </View>
      <Text style={styles.source}>来源：{strategy.evidence.join("、")}</Text>
    </Card>
  );
}

function ChecklistCard({
  title,
  icon,
  items,
  emptyText
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  emptyText?: string;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(items.slice(0, 2).map((item) => [item, true]))
  );

  return (
    <Card>
      <View style={styles.headerRow}>
        {icon}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View style={styles.checkList}>
        {items.length === 0 ? <Text style={styles.body}>{emptyText ?? "暂无可整理内容。"}</Text> : null}
        {items.map((item) => {
          const isChecked = checked[item];
          return (
            <Pressable
              key={item}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!isChecked }}
              hitSlop={hitSlop}
              onPress={() => setChecked((current) => ({ ...current, [item]: !current[item] }))}
              style={styles.checkRow}
            >
              <View style={[styles.checkbox, isChecked && styles.checkboxDone]}>
                {isChecked ? <Check color="#FFFFFF" size={16} /> : null}
              </View>
              <Text style={styles.checkText}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function reportHtml(recordCount: number, attentionItems: AttentionItem[], memories: MemoryItem[]) {
  const questions = buildDoctorQuestions(attentionItems);
  const summaryBullets = buildSummaryBullets(attentionItems);
  const triedStrategies = memories.filter((item) => item.status === "confirmed").map((item) => item.title);

  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; padding: 32px; color: #1F2933; }
          h1 { font-size: 24px; margin: 0 0 6px; }
          .note { color: #52616B; font-size: 13px; margin-bottom: 24px; }
          h2 { font-size: 16px; margin-top: 22px; border-bottom: 1px solid #E4E0D8; padding-bottom: 6px; }
          li { margin-bottom: 8px; line-height: 1.55; }
          .footer { margin-top: 32px; font-size: 12px; color: #52616B; }
        </style>
      </head>
      <body>
        <h1>CareMind 近 7 天照护摘要</h1>
        <div class="note">本摘要为家属照护记录整理，不包含医生诊断。</div>
        <h2>一、照护记录概况</h2>
        <ul>
          <li>已保存 ${recordCount} 条家庭照护记录。</li>
          <li>${recordCount >= 7 ? "已达到完整 7 天摘要条件。" : "当前仍处于数据积累阶段。"}</li>
        </ul>
        <h2>二、主要变化摘要</h2>
        <ul>
          ${summaryBullets.map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <h2>三、已尝试方法</h2>
        <ul>
          ${(triedStrategies.length ? triedStrategies : ["暂无已确认方法"]).map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <h2>四、建议复诊时询问</h2>
        <ul>
          ${questions.map((q) => `<li>${q}</li>`).join("")}
        </ul>
        <h2>五、复诊资料清单</h2>
        <ul>
          ${materials.map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <div class="footer">影像、量表、诊断和用药结论需由医生判断。由家属自行决定是否分享给医生。</div>
      </body>
    </html>
  `;
}

export function FollowupPrepScreen() {
  const { patient, recordCount, followupMetrics, memoryItems, attentionItems } = useCareMind();
  const [range, setRange] = useState<Range>("7d");
  const [exporting, setExporting] = useState(false);
  const doctorQuestions = useMemo(() => buildDoctorQuestions(attentionItems), [attentionItems]);

  async function exportPdf() {
    try {
      setExporting(true);
      const { uri } = await Print.printToFileAsync({ html: reportHtml(recordCount, attentionItems, memoryItems) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert("PDF 已生成", uri);
      }
    } catch {
      Alert.alert("PDF 生成失败", "你可以先复制页面文字，之后再重试导出。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen bottomInset={128}>
      <PageHeader title="复诊准备" subtitle={`${patient.nickname} · 家属记录整理`} />
      {recordCount > 0 ? <MemoryUsedPill label="已读取已保存记录和已记住的方法" /> : null}
      <View style={styles.spacer} />
      <ProgressCard recordCount={recordCount} />
      {recordCount >= 3 ? <RangeSelector range={range} onChange={setRange} /> : null}

      {recordCount > 0 ? (
        <>
          <SectionTitle title="核心指标" />
          <MetricsGrid metrics={followupMetrics} />
          <ClinicalSummarySheet recordCount={recordCount} attentionItems={attentionItems} />
          <TriedStrategiesCard confirmedMemories={memoryItems.filter((item) => item.status === "confirmed")} />
          <ChecklistCard
            title="建议复诊时问医生"
            icon={<Stethoscope color={colors.brand.primaryDark} size={21} />}
            items={doctorQuestions}
            emptyText="记录更多事件后，问题清单会自动生成。"
          />
          <ChecklistCard title="复诊资料清单" icon={<ListChecks color={colors.status.info} size={21} />} items={materials} />
          <View style={styles.exportWrap}>
            <Button
              label="导出复诊摘要 PDF"
              loading={exporting}
              icon={<Download color="#FFFFFF" size={19} />}
              onPress={exportPdf}
            />
            <Text style={styles.exportNote}>本摘要为家属照护记录整理，不包含医生诊断。</Text>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: {
    height: 12
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text.primary,
    flex: 1
  },
  body: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 8
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF99",
    marginTop: 14,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.brand.primary
  },
  progressAction: {
    marginTop: 14
  },
  segmented: {
    minHeight: 48,
    borderRadius: 17,
    backgroundColor: colors.surface.muted,
    flexDirection: "row",
    padding: 4,
    marginBottom: 14
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14
  },
  segmentActive: {
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle
  },
  segmentText: {
    ...typography.label,
    color: colors.text.secondary
  },
  segmentTextActive: {
    color: colors.text.primary
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  metricSurface: {
    width: "47.8%",
    minHeight: 112,
    padding: 14,
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: colors.text.primary
  },
  metricLabel: {
    ...typography.label,
    color: colors.text.primary,
    marginTop: 4
  },
  metricHelper: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  reportTitleBlock: {
    flex: 1
  },
  reportTitle: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  reportSubtitle: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 2
  },
  rule: {
    height: 1,
    backgroundColor: colors.border.subtle,
    marginVertical: 14
  },
  reportSectionTitle: {
    ...typography.label,
    color: colors.text.primary,
    marginTop: 10
  },
  reportBullet: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 6
  },
  strategyGroup: {
    marginTop: 12
  },
  strategyTitle: {
    ...typography.label,
    color: colors.brand.primaryDark
  },
  source: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 12
  },
  checkList: {
    marginTop: 12
  },
  checkRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 10,
    marginBottom: 8,
    backgroundColor: colors.surface.muted
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.strong
  },
  checkboxDone: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary
  },
  checkText: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  exportWrap: {
    gap: 8,
    marginTop: 4
  },
  exportNote: {
    ...typography.small,
    textAlign: "center",
    color: colors.text.secondary
  }
});

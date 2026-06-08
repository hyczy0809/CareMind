import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import {
  Check,
  ClipboardCheck,
  FileText,
  HelpCircle,
  ListChecks,
  Trash2,
  UploadCloud
} from "lucide-react-native";
import type {
  AttentionItem,
  FollowupDocumentRecord,
  FollowupDocumentStatus,
  FollowupDocumentType,
  MemoryItem
} from "../../types/caremind";
import { useCareMind } from "../../lib/caremind-store";
import {
  deleteMedicalDocument,
  confirmMedicalDocumentReview,
  generateFollowupSummary,
  getMedicalDocument,
  parseMedicalDocument,
  uploadMedicalDocument
} from "../../lib/care-workflow-api";
import type { FollowupSummaryResponse } from "../../types/care-workflow";
import { colors, hitSlop, typography } from "../../lib/theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Pill } from "../ui/Pill";
import { Screen } from "../ui/Screen";
import { MemoryUsedPill } from "../memory/MemoryUsedPill";

type Range = "7d" | "30d" | "custom";

const materials = ["近期用药清单", "近 7 天照护摘要", "MRI / CT 检查报告", "认知量表结果", "想问医生的问题"];
const supportedMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];
const maxFileSize = 10 * 1024 * 1024;
const supplementTypeOptions: { label: string; value: FollowupDocumentType }[] = [
  { label: "病历摘要", value: "clinic_note" },
  { label: "MRI / CT", value: "imaging_report" },
  { label: "认知量表", value: "scale_result" },
  { label: "用药清单", value: "medication_list" },
  { label: "手动摘要", value: "manual_summary" }
];

function formatFileSize(size?: number) {
  if (!size) return "大小未知";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isSupportedFile(asset: DocumentPicker.DocumentPickerAsset) {
  const mimeType = asset.mimeType ?? "";
  const fileName = asset.name.toLowerCase();
  return (
    supportedMimeTypes.includes(mimeType) ||
    fileName.endsWith(".pdf") ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg") ||
    fileName.endsWith(".png") ||
    fileName.endsWith(".docx")
  );
}

function supplementStatusLabel(status: FollowupDocumentStatus) {
  if (status === "uploading") return "上传中";
  if (status === "parsing") return "整理中";
  if (status === "review_required") return "待确认";
  if (status === "reviewed") return "已确认";
  if (status === "uploaded") return "已上传";
  if (status === "failed") return "需处理";
  return "已选择";
}

function supplementStatusTone(status: FollowupDocumentStatus) {
  if (status === "reviewed") return "brand" as const;
  if (status === "failed") return "watch" as const;
  if (status === "review_required") return "watch" as const;
  return "info" as const;
}


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

function buildConfirmedSupplementItems(supplements: FollowupDocumentRecord[]) {
  return supplements
    .filter((item) => item.status === "reviewed")
    .flatMap((item) => {
      if (item.confirmedItems?.length) {
        return item.confirmedItems.map((entry) =>
          entry.startsWith(`${item.title}：`) || entry.startsWith("已补充") || entry.startsWith("该资料")
            ? entry
            : `${item.title}：${entry}`
        );
      }
      return item.summary ? [`${item.title}：${item.summary}`] : [`${item.title}：已由家属确认`];
    });
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

function rangeLabel(range: Range) {
  if (range === "30d") return "近 30 天";
  if (range === "custom") return "自定义范围";
  return "近 7 天";
}

function ReportSyncStatusCard({
  loading,
  error,
  report
}: {
  loading: boolean;
  error: string | null;
  report: FollowupSummaryResponse | null;
}) {
  if (loading) {
    return (
      <Card tone="info">
        <Text style={styles.cardTitle}>正在整理复诊摘要</Text>
        <Text style={styles.body}>我会把已保存记录和已确认资料一起发送到摘要接口。</Text>
      </Card>
    );
  }

  if (report) {
    return (
      <Card tone="brand">
        <Text style={styles.cardTitle}>复诊摘要已同步</Text>
        <Text style={styles.body}>摘要已包含照护记录、已确认资料和医疗边界说明。</Text>
      </Card>
    );
  }

  if (error) {
    return (
      <Card tone="watch">
        <Text style={styles.cardTitle}>当前使用本地摘要</Text>
        <Text style={styles.body}>{error}</Text>
      </Card>
    );
  }

  return null;
}

function DocumentSupplementEntryCard() {
  const { patient, followupDocuments: supplements, trackEvent, updateFollowupDocuments } = useCareMind();
  const [selectedType, setSelectedType] = useState<FollowupDocumentType>("clinic_note");
  const [manualSummary, setManualSummary] = useState("");

  function selectedTypeLabel(type = selectedType) {
    return supplementTypeOptions.find((item) => item.value === type)?.label ?? "复诊资料";
  }

  function setSupplements(updater: (current: FollowupDocumentRecord[]) => FollowupDocumentRecord[]) {
    updateFollowupDocuments(updater);
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ],
        copyToCacheDirectory: true,
        multiple: false
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      if (!isSupportedFile(asset)) {
        const now = new Date().toISOString();
        setSupplements((current) => [
          {
            id: `supplement_failed_${Date.now()}`,
            patientId: patient.id,
            type: selectedType,
            title: selectedTypeLabel(),
            filename: asset.name,
            mimeType: asset.mimeType,
            size: asset.size,
            summary: manualSummary.trim(),
            status: "failed",
            error: "暂只支持 PDF、JPG、PNG、DOCX。",
            createdAt: now,
            updatedAt: now
          },
          ...current
        ]);
        return;
      }

      if (asset.size && asset.size > maxFileSize) {
        const now = new Date().toISOString();
        setSupplements((current) => [
          {
            id: `supplement_failed_${Date.now()}`,
            patientId: patient.id,
            type: selectedType,
            title: selectedTypeLabel(),
            filename: asset.name,
            mimeType: asset.mimeType,
            size: asset.size,
            summary: manualSummary.trim(),
            status: "failed",
            error: "文件超过 10MB，建议压缩后再上传。",
            createdAt: now,
            updatedAt: now
          },
          ...current
        ]);
        return;
      }

      const localId = `supplement_${Date.now()}`;
      const createdAt = new Date().toISOString();
      trackEvent("document_upload_started", {
        document_type: selectedType,
        has_summary: !!manualSummary.trim()
      });
      setSupplements((current) => [
        {
          id: localId,
          patientId: patient.id,
          type: selectedType,
          title: selectedTypeLabel(),
          filename: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
          summary: manualSummary.trim(),
          status: "uploading",
          createdAt,
          updatedAt: createdAt
        },
        ...current
      ]);

      let uploadedDocumentId: string | null = null;
      try {
        const uploaded = await uploadMedicalDocument({
          patientId: patient.id,
          documentType: selectedType,
          summary: manualSummary.trim(),
          asset: {
            uri: asset.uri,
            name: asset.name,
            mimeType: asset.mimeType
          }
        });
        uploadedDocumentId = uploaded.document_id;
        trackEvent("document_upload_succeeded", {
          document_id: uploaded.document_id,
          document_type: uploaded.document_type,
          file_size: uploaded.file_size
        });
        const statusRecord = await getMedicalDocument(uploaded.document_id);
        setSupplements((current) =>
          current.map((item) =>
            item.id === localId
              ? {
                  ...item,
                  documentId: statusRecord.document_id,
                  status: statusRecord.status === "deleted" ? "failed" : "parsing",
                  filename: statusRecord.filename,
                  mimeType: statusRecord.mime_type,
                  size: statusRecord.file_size,
                  error: statusRecord.status === "deleted" ? "资料已删除。" : undefined,
                  updatedAt: new Date().toISOString()
                }
              : item
          )
        );

        trackEvent("document_parse_started", {
          document_id: uploaded.document_id,
          document_type: uploaded.document_type
        });
        const parseResult = await parseMedicalDocument(uploaded.document_id);
        if (parseResult.status === "parse_failed") {
          trackEvent("document_parse_failed", {
            document_id: uploaded.document_id,
            reason: parseResult.parse_error ?? "unknown"
          });
          setSupplements((current) =>
            current.map((item) =>
              item.id === localId
                ? {
                    ...item,
                    status: "failed",
                    parseResult,
                    error: parseResult.parse_error ?? "资料整理失败，请改为手动填写摘要。",
                    updatedAt: new Date().toISOString()
                  }
                : item
            )
          );
          return;
        }

        trackEvent("document_parse_succeeded", {
          document_id: uploaded.document_id,
          field_count: parseResult.extracted_fields.length,
          question_count: parseResult.review_questions.length
        });
        setSupplements((current) =>
          current.map((item) =>
            item.id === localId
              ? {
                  ...item,
                  status: "review_required",
                  parseResult,
                  error: undefined,
                  updatedAt: new Date().toISOString()
                }
              : item
          )
        );
        setManualSummary("");
      } catch (error) {
        if (uploadedDocumentId) {
          trackEvent("document_parse_failed", {
            document_id: uploadedDocumentId,
            reason: error instanceof Error ? error.message : "unknown"
          });
        } else {
          trackEvent("document_upload_failed", {
            document_type: selectedType,
            reason: error instanceof Error ? error.message : "unknown"
          });
        }
        setSupplements((current) =>
          current.map((item) =>
            item.id === localId
              ? {
                  ...item,
                  status: "failed",
                  error: error instanceof Error ? error.message : "资料上传失败，请稍后重试。",
                  updatedAt: new Date().toISOString()
                }
              : item
          )
        );
      }
    } catch {
      const now = new Date().toISOString();
      setSupplements((current) => [
        {
          id: `supplement_failed_${Date.now()}`,
          patientId: patient.id,
          type: selectedType,
          title: selectedTypeLabel(),
          summary: manualSummary.trim(),
          status: "failed",
          error: "无法打开文件选择器，请稍后重试。",
          createdAt: now,
          updatedAt: now
        },
        ...current
      ]);
    }
  }

  function addManualSummary() {
    const summary = manualSummary.trim();
    if (!summary) {
      Alert.alert("先写一点摘要", "可以只写医生说明、当前用药、检查类型或家属想问医生的问题。");
      return;
    }

    setSupplements((current) => [
      {
        id: `manual_supplement_${Date.now()}`,
        patientId: patient.id,
        type: selectedType,
        title: selectedTypeLabel(),
        summary,
        status: "reviewed",
        confirmedItems: [`家属手动补充：${summary}`],
        reviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      ...current
    ]);
    trackEvent("document_review_confirmed", {
      document_type: selectedType,
      source: "manual_summary"
    });
    setManualSummary("");
  }

  async function removeSupplement(item: FollowupDocumentRecord) {
    if (item.documentId) {
      try {
        await deleteMedicalDocument(item.documentId);
      } catch (error) {
        Alert.alert("删除失败", error instanceof Error ? error.message : "后端删除失败，请稍后重试。");
        return;
      }
    }
    setSupplements((current) => current.filter((entry) => entry.id !== item.id));
    trackEvent("document_deleted", {
      document_id: item.documentId ?? item.id,
      document_type: item.type
    });
  }

  async function confirmSupplementReview(item: FollowupDocumentRecord) {
    if (!item.documentId || !item.parseResult) {
      return;
    }

    try {
      const response = await confirmMedicalDocumentReview({
        documentId: item.documentId,
        confirmedItems: item.parseResult.followup_summary_items,
        familyNote: item.summary
      });
      setSupplements((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "reviewed",
                confirmedItems: response.confirmed_items,
                reviewedAt: response.reviewed_at,
                error: undefined,
                updatedAt: new Date().toISOString()
              }
            : entry
        )
      );
      trackEvent("document_review_confirmed", {
        document_id: item.documentId,
        document_type: item.type,
        confirmed_count: response.confirmed_items.length
      });
    } catch (error) {
      setSupplements((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                error: error instanceof Error ? error.message : "资料确认失败，请稍后重试。",
                updatedAt: new Date().toISOString()
              }
            : entry
        )
      );
    }
  }

  return (
    <Card tone="info">
      <View style={styles.headerRow}>
        <FileText color={colors.status.info} size={21} />
        <Text style={styles.cardTitle}>复诊资料补充</Text>
      </View>
      <Text style={styles.body}>把病历、检查报告、认知量表、用药清单或家属手动摘要放在这里，之后会和近期照护记录一起进入复诊材料。</Text>
      <View style={styles.documentChipRow}>
        {supplementTypeOptions.map((item) => {
          const selected = selectedType === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={hitSlop}
              onPress={() => setSelectedType(item.value)}
              style={[styles.documentChip, selected && styles.documentChipSelected]}
            >
              <Text style={[styles.documentChipText, selected && styles.documentChipTextSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.formLabel}>资料摘要</Text>
      <TextInput
        accessibilityLabel="复诊资料摘要"
        multiline
        value={manualSummary}
        onChangeText={setManualSummary}
        placeholder="例如：当前用药、上次医生说明、检查类型、家属想问医生的问题"
        placeholderTextColor={colors.text.muted}
        style={styles.summaryInput}
        textAlignVertical="top"
      />

      <View style={styles.documentBoundaryBox}>
        <Text style={styles.documentBoundaryText}>
          上传资料可能包含敏感健康信息。CareMind 只做资料整理和术语辅助，不判断是否需要检查，也不调整用药。
        </Text>
      </View>

      <View style={styles.documentActions}>
        <Button label="选择文件" icon={<UploadCloud color="#FFFFFF" size={19} />} onPress={pickDocument} />
        <Button label="只保存摘要" variant="secondary" onPress={addManualSummary} />
      </View>

      {supplements.length > 0 ? (
        <View style={styles.supplementList}>
          {supplements.map((item) => (
            <View key={item.id} style={[styles.supplementItem, item.status === "failed" && styles.supplementItemFailed]}>
              <View style={styles.supplementMain}>
                <View style={styles.supplementHeader}>
                  <Text style={styles.supplementTitle}>{item.title}</Text>
                  <Pill label={supplementStatusLabel(item.status)} tone={supplementStatusTone(item.status)} />
                </View>
                {item.filename ? (
                  <Text style={styles.supplementMeta}>
                    {item.filename} · {formatFileSize(item.size)}
                  </Text>
                ) : (
                  <Text style={styles.supplementMeta}>手动填写摘要</Text>
                )}
                {item.summary ? <Text style={styles.supplementSummary}>{item.summary}</Text> : null}
                {item.error ? <Text style={styles.supplementError}>{item.error}</Text> : null}
                {item.parseResult ? (
                  <View style={styles.parseBox}>
                    <Text style={styles.parseTitle}>CareMind 整理草稿</Text>
                    <View style={styles.parseFieldList}>
                      {item.parseResult.extracted_fields.map((field) => (
                        <View key={`${item.id}_${field.field}`} style={styles.parseFieldRow}>
                          <Text style={styles.parseFieldLabel}>{field.label}</Text>
                          <Text style={styles.parseFieldValue}>{field.value}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.parseTitle}>需要核对</Text>
                    {item.parseResult.review_questions.map((question) => (
                      <Text key={`${item.id}_${question.id}`} style={styles.reviewQuestion}>
                        - {question.question}
                      </Text>
                    ))}
                    <Text style={styles.boundaryText}>{item.parseResult.medical_boundary}</Text>
                    {item.status === "review_required" ? (
                      <View style={styles.reviewAction}>
                        <Button
                          label="确认并用于复诊"
                          variant="secondary"
                          onPress={() => void confirmSupplementReview(item)}
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {item.confirmedItems?.length ? (
                  <View style={styles.confirmedBox}>
                    <Text style={styles.confirmedTitle}>已进入复诊材料</Text>
                    {item.confirmedItems.map((entry) => (
                      <Text key={`${item.id}_${entry}`} style={styles.confirmedItem}>
                        - {entry}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`删除${item.title}`}
                hitSlop={hitSlop}
                onPress={() => void removeSupplement(item)}
                style={styles.deleteButton}
              >
                <Trash2 color={colors.text.secondary} size={18} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function ClinicalSummarySheet({ recordCount, summaryBullets }: { recordCount: number; summaryBullets: string[] }) {
  return (
    <Card>
      <View style={styles.reportHeader}>
        <View style={styles.reportTitleBlock}>
          <Text style={styles.reportTitle}>家属照护记录</Text>
          <Text style={styles.reportSubtitle}>家属整理 · 不包含医生诊断</Text>
        </View>
        <Pill label={recordCount >= 7 ? "CareMind" : "数据积累中"} tone={recordCount >= 7 ? "brand" : "watch"} />
      </View>
      <View style={styles.rule} />
      <Text style={styles.reportSectionTitle}>照护概况</Text>
      <Text style={styles.reportBullet}>已保存 {recordCount} 条家庭照护记录。</Text>
      <Text style={styles.reportBullet}>以下内容来自家属自行输入、保存和确认的照护记录。</Text>

      <Text style={styles.reportSectionTitle}>近期变化</Text>
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

function buildCopySummaryText({
  recordCount,
  summaryBullets,
  questions,
  materialItems,
  triedStrategies,
  rangeLabel,
  generatedAt
}: {
  recordCount: number;
  summaryBullets: string[];
  questions: string[];
  materialItems: string[];
  triedStrategies: string[];
  rangeLabel: string;
  generatedAt: string;
}) {
  const bullet = (items: string[], fallback: string) => (items.length ? items : [fallback]).map((item) => `- ${item}`).join("\n");

  return [
    `CareMind ${rangeLabel}复诊沟通摘要`,
    `生成时间：${generatedAt}`,
    "说明：以下内容为家属照护记录整理，不包含医生诊断、检查判断或用药建议。",
    "",
    "一、照护记录概况",
    `- 已保存 ${recordCount} 条家庭照护记录。`,
    `- ${recordCount >= 7 ? "已达到完整 7 天摘要条件。" : "当前仍处于数据积累阶段。"}`,
    "",
    "二、主要变化摘要",
    bullet(summaryBullets, "暂无明确变化摘要。"),
    "",
    "三、已尝试方法",
    bullet(triedStrategies, "暂无已确认方法。"),
    "",
    "四、建议复诊时询问",
    bullet(questions, "暂无问题清单。"),
    "",
    "五、复诊资料清单",
    bullet(materialItems, "暂无资料清单。"),
    "",
    "边界说明：影像、量表、诊断和用药结论需由医生判断。是否分享给医生由家属自行决定。"
  ].join("\n");
}

export function FollowupPrepScreen() {
  const { patient, recordCount, memoryItems, attentionItems, followupDocuments, trackEvent } = useCareMind();
  const [range, setRange] = useState<Range>("7d");
  const [copying, setCopying] = useState(false);
  const [copySheetVisible, setCopySheetVisible] = useState(false);
  const [copySummaryText, setCopySummaryText] = useState("");
  const [report, setReport] = useState<FollowupSummaryResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const reviewedFollowupDocuments = useMemo(
    () => followupDocuments.filter((item) => item.status === "reviewed"),
    [followupDocuments]
  );
  const confirmedSupplementItems = useMemo(() => buildConfirmedSupplementItems(reviewedFollowupDocuments), [reviewedFollowupDocuments]);
  const localQuestions = useMemo(() => buildDoctorQuestions(attentionItems), [attentionItems]);
  const localSummaryBullets = useMemo(() => buildSummaryBullets(attentionItems), [attentionItems]);
  const localTriedStrategies = useMemo(
    () => memoryItems.filter((item) => item.status === "confirmed").map((item) => item.title),
    [memoryItems]
  );
  const doctorQuestions = report?.followup_patch.doctor_questions.length ? report.followup_patch.doctor_questions : localQuestions;
  const summaryBullets = report?.followup_patch.summary_bullets.length ? report.followup_patch.summary_bullets : localSummaryBullets;
  const triedStrategies = report?.tried_strategies.length ? report.tried_strategies : localTriedStrategies;
  const materialItems = report?.followup_patch.materials_to_bring.length
    ? report.followup_patch.materials_to_bring
    : [...materials, ...confirmedSupplementItems];
  const hasReportContent = recordCount > 0 || reviewedFollowupDocuments.length > 0;

  useEffect(() => {
    let cancelled = false;

    if (recordCount <= 0 && reviewedFollowupDocuments.length === 0) {
      setReport(null);
      setReportError(null);
      setReportLoading(false);
      return;
    }

    async function loadReport() {
      try {
        setReportLoading(true);
        setReportError(null);
        const response = await generateFollowupSummary({
          patientId: patient.id,
          caregiverId: "local_caregiver",
          dateRange: range,
          recordCount,
          attentionItems,
          memoryItems,
          followupDocuments: reviewedFollowupDocuments
        });

        if (cancelled) return;
        setReport(response);
        trackEvent("followup_report_loaded", {
          range,
          record_count: recordCount,
          attention_count: attentionItems.length,
          document_count: reviewedFollowupDocuments.length,
          source: "backend"
        });
      } catch (error) {
        if (cancelled) return;
        setReport(null);
        setReportError(error instanceof Error ? error.message : "复诊摘要接口暂不可用，当前展示本地摘要。");
        trackEvent("followup_report_failed", {
          range,
          record_count: recordCount,
          document_count: reviewedFollowupDocuments.length,
          reason: error instanceof Error ? error.message : "unknown"
        });
      } finally {
        if (!cancelled) {
          setReportLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      cancelled = true;
    };
  }, [attentionItems, memoryItems, patient.id, range, recordCount, reviewedFollowupDocuments, trackEvent]);

  function handleRangeChange(nextRange: Range) {
    setRange(nextRange);
    trackEvent("followup_range_changed", {
      range: nextRange,
      record_count: recordCount,
      document_count: reviewedFollowupDocuments.length
    });
  }

  function prepareCopySummary() {
    try {
      trackEvent("followup_copy_started", {
        range,
        record_count: recordCount,
        document_count: reviewedFollowupDocuments.length,
        report_source: report ? "backend" : "local"
      });
      const text = buildCopySummaryText({
        recordCount,
        summaryBullets,
        questions: doctorQuestions,
        materialItems,
        triedStrategies,
        rangeLabel: rangeLabel(range),
        generatedAt: report?.generated_at ?? new Date().toLocaleString("zh-CN", { hour12: false })
      });
      setCopySummaryText(text);
      setCopySheetVisible(true);
    } catch (error) {
      trackEvent("followup_copy_failed", {
        range,
        record_count: recordCount,
        document_count: reviewedFollowupDocuments.length,
        reason: error instanceof Error ? error.message : "unknown"
      });
      Alert.alert("摘要生成失败", "你可以先复制页面文字，之后再重试。");
    }
  }

  async function copySummaryToClipboard() {
    if (!copySummaryText.trim()) return;

    try {
      setCopying(true);
      await Clipboard.setStringAsync(copySummaryText);
      trackEvent("followup_copy_succeeded", {
        range,
        record_count: recordCount,
        document_count: reviewedFollowupDocuments.length,
        text_length: copySummaryText.length
      });
      Alert.alert("已复制", "复诊摘要已复制，可以粘贴到微信、备忘录或发给医生。");
    } catch (error) {
      trackEvent("followup_copy_failed", {
        range,
        record_count: recordCount,
        document_count: reviewedFollowupDocuments.length,
        reason: error instanceof Error ? error.message : "unknown"
      });
      Alert.alert("复制失败", "可以长按文本手动选择复制。");
    } finally {
      setCopying(false);
    }
  }

  return (
    <Screen bottomInset={128}>
      <PageHeader title="复诊准备" subtitle="把照护记录和复诊资料整理成医生能看的摘要" />
      {hasReportContent ? <MemoryUsedPill label="已读取已保存记录、已记住方法和已确认资料" /> : null}
      <View style={styles.spacer} />
      <DocumentSupplementEntryCard />
      {recordCount >= 3 ? <RangeSelector range={range} onChange={handleRangeChange} /> : null}

      {hasReportContent ? (
        <>
          <ReportSyncStatusCard loading={reportLoading} error={reportError} report={report} />
          <ClinicalSummarySheet recordCount={recordCount} summaryBullets={summaryBullets} />
          <TriedStrategiesCard confirmedMemories={memoryItems.filter((item) => item.status === "confirmed")} />
          <ChecklistCard
            title="建议复诊时问医生"
            icon={<HelpCircle color={colors.brand.primaryDark} size={21} />}
            items={doctorQuestions}
            emptyText="记录更多事件后，问题清单会自动生成。"
          />
          <ChecklistCard title="复诊资料清单" icon={<ListChecks color={colors.status.info} size={21} />} items={materialItems} />
          <View style={styles.exportWrap}>
            <Text style={styles.exportNote}>本摘要为家属照护记录整理，不包含医生诊断。</Text>
            <Button
              label="生成可复制摘要"
              icon={<ClipboardCheck color="#FFFFFF" size={19} />}
              onPress={prepareCopySummary}
            />
          </View>
        </>
      ) : null}

      <Modal visible={copySheetVisible} transparent animationType="slide" onRequestClose={() => setCopySheetVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.copySheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>可复制复诊摘要</Text>
            <Text style={styles.sheetHelper}>可直接复制到微信、备忘录，或复诊时给医生看。</Text>
            <ScrollView
              accessibilityLabel="可复制复诊摘要"
              style={styles.copyScroll}
              contentContainerStyle={styles.copyScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <Text selectable style={styles.copyText}>
                {copySummaryText}
              </Text>
            </ScrollView>
            <View style={styles.sheetActions}>
              <Button label="复制整段文字" loading={copying} onPress={copySummaryToClipboard} />
              <Button label="关闭" variant="ghost" onPress={() => setCopySheetVisible(false)} />
            </View>
          </View>
        </View>
      </Modal>
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
  documentChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14
  },
  documentChip: {
    minHeight: 36,
    borderRadius: 18,
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: "#C9D8E2"
  },
  documentChipSelected: {
    backgroundColor: colors.status.info,
    borderColor: colors.status.info
  },
  documentChipText: {
    ...typography.small,
    color: colors.status.info,
    fontWeight: "800" as const
  },
  documentChipTextSelected: {
    color: colors.text.inverse
  },
  formLabel: {
    ...typography.label,
    color: colors.text.primary,
    marginTop: 16,
    marginBottom: 8
  },
  summaryInput: {
    minHeight: 92,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,248,0.74)",
    padding: 12,
    ...typography.helper,
    color: colors.text.primary
  },
  documentBoundaryBox: {
    borderRadius: 14,
    backgroundColor: "rgba(255,253,248,0.74)",
    borderWidth: 1,
    borderColor: "#C9D8E2",
    padding: 10,
    marginTop: 14
  },
  documentBoundaryText: {
    ...typography.small,
    color: colors.text.secondary
  },
  documentActions: {
    gap: 8,
    marginTop: 14
  },
  supplementList: {
    gap: 10,
    marginTop: 14
  },
  supplementItem: {
    minHeight: 82,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.card,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12
  },
  supplementItemFailed: {
    borderColor: "#F2CF86",
    backgroundColor: colors.statusSoft.watch
  },
  supplementMain: {
    flex: 1
  },
  supplementHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  supplementTitle: {
    ...typography.label,
    color: colors.text.primary,
    flex: 1
  },
  supplementMeta: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 4
  },
  supplementSummary: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 7
  },
  supplementError: {
    ...typography.small,
    color: colors.status.watch,
    marginTop: 7
  },
  parseBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.muted,
    padding: 10,
    marginTop: 10
  },
  parseTitle: {
    ...typography.small,
    color: colors.text.primary,
    fontWeight: "800" as const,
    marginBottom: 6
  },
  parseFieldList: {
    gap: 6,
    marginBottom: 10
  },
  parseFieldRow: {
    borderRadius: 12,
    backgroundColor: colors.surface.card,
    padding: 9
  },
  parseFieldLabel: {
    ...typography.small,
    color: colors.text.muted
  },
  parseFieldValue: {
    ...typography.helper,
    color: colors.text.primary,
    marginTop: 2
  },
  reviewQuestion: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: 4
  },
  boundaryText: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 8
  },
  reviewAction: {
    marginTop: 10
  },
  confirmedBox: {
    borderRadius: 14,
    backgroundColor: colors.brand.primarySoft,
    padding: 10,
    marginTop: 10
  },
  confirmedTitle: {
    ...typography.small,
    color: colors.brand.primaryDark,
    fontWeight: "800" as const,
    marginBottom: 4
  },
  confirmedItem: {
    ...typography.small,
    color: colors.brand.primaryDark,
    marginTop: 3
  },
  deleteButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface.muted
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
    borderRadius: 13,
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
    textAlign: "left",
    color: colors.text.muted,
    marginBottom: 8
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(31,41,51,0.28)"
  },
  copySheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface.elevated,
    padding: 16,
    paddingBottom: 30
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.subtle,
    alignSelf: "center",
    marginBottom: 16
  },
  sheetTitle: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  sheetHelper: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 6
  },
  copyScroll: {
    minHeight: 260,
    maxHeight: 420,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.card,
    marginTop: 14
  },
  copyScrollContent: {
    padding: 12,
    paddingBottom: 18
  },
  copyText: {
    ...typography.helper,
    color: colors.text.primary
  },
  sheetActions: {
    gap: 8,
    marginTop: 14
  },
});

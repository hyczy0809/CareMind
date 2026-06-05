import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ChevronRight, Eye, FileText, HeartHandshake, MessageSquare } from "lucide-react-native";
import { useCareMind } from "../../lib/caremind-store";
import { colors, hitSlop, typography } from "../../lib/theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";

const nicknameChips = [
  "妈妈",
  "爸爸",
  "奶奶",
  "爷爷",
  "外婆",
  "外公",
  "老伴",
  "婆婆",
  "公公",
  "岳母",
  "岳父"
];
const concernChips = ["夜里起来了", "不肯吃饭", "说有人偷钱", "不肯吃药"];
const detailRiskChips = [
  "夜间起床或开门",
  "走失/迷路",
  "跌倒或步态不稳",
  "拒药/漏药",
  "少食或呛咳",
  "被害感表达",
  "黄昏焦虑",
  "照护者压力"
];

function buildDetailNote(input: {
  condition: string;
  documentNote: string;
  medicationNote: string;
  riskTags: string[];
  preferenceNote: string;
}) {
  const sections = [
    input.condition.trim() ? `医生/诊断相关记录：${input.condition.trim()}` : "",
    input.documentNote.trim() ? `病历/检查资料：${input.documentNote.trim()}` : "",
    input.medicationNote.trim() ? `当前用药/基础病：${input.medicationNote.trim()}` : "",
    input.riskTags.length > 0 ? `近期照护重点：${input.riskTags.join("、")}` : "",
    input.preferenceNote.trim() ? `沟通偏好/有效安抚方式：${input.preferenceNote.trim()}` : ""
  ].filter(Boolean);

  return sections.join("\n");
}

function toggleTag(current: string[], tag: string) {
  return current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
}

function StepProgressBar({ step }: { step: number }) {
  return (
    <View style={styles.stepper}>
      {[0, 1, 2].map((item) => (
        <View
          key={item}
          style={[styles.stepSegment, item < step && styles.stepSegmentDone, item === step && styles.stepSegmentActive]}
        />
      ))}
    </View>
  );
}

const introSlides = [
  {
    key: "positioning",
    pill: "面向失智症家庭照护者",
    title: "照顾家人的路，\n你不用一个人摸索",
    body: "睡眠变化、拒药、情绪波动……每天发生的事记不住、说不清、复诊时靠回忆。\n\nCareMind 帮你把这些整理清楚——不替代医生，只做你身边最可靠的照护记录伙伴。"
  },
  {
    key: "features",
    pill: "它能帮你做三件事",
    title: "记录、整理、沟通",
    body: ""
  },
  {
    key: "start",
    pill: "",
    title: "你不是一个人在扛",
    body: "照顾失智的家人，有时候太累、太乱，说不清楚也没关系。\n你说，我来帮你记——一天一天，慢慢整理清楚。"
  }
];

const features = [
  {
    icon: MessageSquare,
    title: "把今天说给我听",
    body: "一句话就够了。我来整理成睡眠、行为、饮食、用药的清晰记录。"
  },
  {
    icon: Eye,
    title: "今天值得留意的事",
    body: "不是诊断，是观察。我把今晚最该留意的地方整理出来，附上今天能做到的建议。"
  },
  {
    icon: FileText,
    title: "复诊材料一键整理",
    body: "把近 7 天的变化整理成医生容易看懂的摘要，带着去复诊。"
  }
];

function IntroDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === current && styles.dotActive]}
        />
      ))}
    </View>
  );
}

function IntroCarousel({ onDone, onDemo }: { onDone: () => void; onDemo: () => void }) {
  const [slide, setSlide] = useState(0);
  const isLast = slide === introSlides.length - 1;
  const current = introSlides[slide];

  return (
    <Screen bottomInset={40}>
      {/* 品牌标识 */}
      <View style={styles.brandRow}>
        <HeartHandshake color={colors.brand.primaryDark} size={18} />
        <Text style={styles.brandName}>CareMind</Text>
      </View>

      {/* 内容区 */}
      <View style={styles.slideContent}>
        {/* 标签 pill */}
        {current.pill ? (
          <View style={styles.slidePill}>
            <Text style={styles.slidePillText}>{current.pill}</Text>
          </View>
        ) : (
          <View style={styles.heroIconWrap}>
            <HeartHandshake color={colors.brand.primaryDark} size={30} />
          </View>
        )}

        <Text style={styles.slideTitle}>{current.title}</Text>

        {/* Slide 0 & 2：正文段落 */}
        {current.body ? (
          <Text style={styles.slideBody}>{current.body}</Text>
        ) : null}

        {/* Slide 1：功能列表 */}
        {current.key === "features" ? (
          <View style={styles.featureList}>
            {features.map((item) => {
              const Icon = item.icon;
              return (
                <View key={item.title} style={styles.featureRow}>
                  <View style={styles.featureIconWrap}>
                    <Icon color={colors.brand.primaryDark} size={20} />
                  </View>
                  <View style={styles.featureCopy}>
                    <Text style={styles.featureTitle}>{item.title}</Text>
                    <Text style={styles.featureBody}>{item.body}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Slide 2：免责声明 */}
        {current.key === "start" ? (
          <Text style={styles.disclaimer}>
            CareMind 不做诊断、不开处方、不替代医生。{"\n"}它帮你记录、整理和沟通。
          </Text>
        ) : null}
      </View>

      {/* 底部导航 */}
      <IntroDots total={introSlides.length} current={slide} />

      <View style={styles.introActions}>
        {isLast ? (
          <>
            <Button
              label="开始设置"
              onPress={onDone}
              icon={<ChevronRight color="#FFFFFF" size={19} />}
            />
            <Button label="加载 3 分钟演示数据" variant="ghost" onPress={onDemo} />
          </>
        ) : (
          <Button
            label="下一步"
            onPress={() => setSlide((s) => s + 1)}
            icon={<ChevronRight color="#FFFFFF" size={19} />}
          />
        )}
      </View>
    </Screen>
  );
}

export function OnboardingScreen() {
  const { completeOnboarding, loadDemoData } = useCareMind();
  const [landed, setLanded] = useState(false);
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState("");
  const [condition, setCondition] = useState("");
  const [documentNote, setDocumentNote] = useState("");
  const [medicationNote, setMedicationNote] = useState("");
  const [riskTags, setRiskTags] = useState<string[]>([]);
  const [preferenceNote, setPreferenceNote] = useState("");
  const [concern, setConcern] = useState("");

  const canContinue = step === 0 ? nickname.trim().length > 0 : step === 2 ? concern.trim().length > 0 : true;

  function handleDemo() {
    loadDemoData();
    router.replace("/(tabs)/today");
  }

  if (!landed) {
    return <IntroCarousel onDone={() => setLanded(true)} onDemo={handleDemo} />;
  }

  function next() {
    if (step < 2) {
      setStep((current) => current + 1);
      return;
    }
    completeOnboarding({
      nickname,
      doctorNote: buildDetailNote({
        condition,
        documentNote,
        medicationNote,
        riskTags,
        preferenceNote
      }),
      concern
    });
    router.replace("/(tabs)/log");
  }

  function skipDoctorNote() {
    setCondition("");
    setDocumentNote("");
    setMedicationNote("");
    setRiskTags([]);
    setPreferenceNote("");
    setStep(2);
  }

  function markDocumentForLater() {
    setDocumentNote((current) =>
      current.trim()
        ? current
        : "待补充病历/检查资料：可记录 MRI/CT、认知量表、血液检查、出院小结或医生复诊意见。"
    );
  }

  return (
    <Screen bottomInset={32}>
      <View style={styles.stepHeader}>
        <View style={styles.stepLogoRow}>
          <HeartHandshake color={colors.brand.primaryDark} size={20} />
          <Text style={styles.stepLogoText}>CareMind</Text>
        </View>
      </View>

      <StepProgressBar step={step} />

      {step === 0 ? (
        <Card>
          <Text style={styles.cardTitle}>你照顾的家人，我们叫 Ta 什么？</Text>
          <TextInput
            accessibilityLabel="家人昵称"
            value={nickname}
            onChangeText={setNickname}
            placeholder="例如：妈妈"
            placeholderTextColor={colors.text.muted}
            style={styles.input}
          />
          <View style={styles.chipRow}>
            {nicknameChips.map((chip) => (
              <Pressable key={chip} accessibilityRole="button" hitSlop={hitSlop} onPress={() => setNickname(chip)} style={styles.chip}>
                <Text style={styles.chipText}>{chip}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <Text style={styles.cardTitle}>详细资料（可选）</Text>
          <Text style={styles.helper}>这些资料用于之后整理复诊摘要，不用于诊断或判断是否需要检查。</Text>
          <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={markDocumentForLater} style={styles.uploadBox}>
            <View style={styles.uploadIcon}>
              <FileText color={colors.brand.primaryDark} size={20} />
            </View>
            <View style={styles.uploadCopy}>
              <Text style={styles.uploadTitle}>添加病历/检查资料</Text>
              <Text style={styles.uploadSubtitle}>Demo 版先填写摘要；后续可接入 PDF/图片上传。</Text>
            </View>
          </Pressable>

          <Text style={styles.label}>医生说明或诊断相关记录</Text>
          <TextInput
            accessibilityLabel="医生说过是什么情况"
            multiline
            value={condition}
            onChangeText={setCondition}
            placeholder="比如：医生说明为失智症相关照护，或正在观察记忆退化"
            placeholderTextColor={colors.text.muted}
            style={[styles.input, styles.textarea]}
            textAlignVertical="top"
          />

          <Text style={styles.label}>病历/检查资料摘要</Text>
          <TextInput
            accessibilityLabel="病历和检查资料摘要"
            multiline
            value={documentNote}
            onChangeText={setDocumentNote}
            placeholder="可写 MRI/CT、认知量表、血液检查、出院小结或复诊结果"
            placeholderTextColor={colors.text.muted}
            style={[styles.input, styles.textareaSmall]}
            textAlignVertical="top"
          />

          <Text style={styles.label}>当前用药、基础病或过敏</Text>
          <TextInput
            accessibilityLabel="当前用药基础病或过敏"
            multiline
            value={medicationNote}
            onChangeText={setMedicationNote}
            placeholder="例如：药名、剂量、服药时间、基础病、过敏史；不要自行调整药量"
            placeholderTextColor={colors.text.muted}
            style={[styles.input, styles.textareaSmall]}
            textAlignVertical="top"
          />

          <Text style={styles.label}>近期照护重点</Text>
          <View style={styles.chipRow}>
            {detailRiskChips.map((chip) => {
              const selected = riskTags.includes(chip);
              return (
                <Pressable
                  key={chip}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  hitSlop={hitSlop}
                  onPress={() => setRiskTags((current) => toggleTag(current, chip))}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{chip}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>偏好、触发因素或有效安抚方式</Text>
          <TextInput
            accessibilityLabel="偏好触发因素或有效安抚方式"
            multiline
            value={preferenceNote}
            onChangeText={setPreferenceNote}
            placeholder="例如：喜欢老歌和照片；直接纠正会更焦虑；下午容易说要回家"
            placeholderTextColor={colors.text.muted}
            style={[styles.input, styles.textareaSmall]}
            textAlignVertical="top"
          />
          <View style={styles.secondaryAction}>
            <Button label="先跳过这步" variant="ghost" onPress={skipDoctorNote} />
          </View>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <Text style={styles.cardTitle}>最近有什么让你放心不下的？</Text>
          <Text style={styles.helper}>随便说说就好，我来帮你整理成第一条记录。</Text>
          <TextInput
            accessibilityLabel="最近最担心的一件事"
            multiline
            value={concern}
            onChangeText={setConcern}
            placeholder="可以只写一句话，比如“妈妈昨晚起了三次”"
            placeholderTextColor={colors.text.muted}
            style={[styles.input, styles.textarea]}
            textAlignVertical="top"
          />
          <View style={styles.chipRow}>
            {concernChips.map((chip) => (
              <Pressable
                key={chip}
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => setConcern((value) => (value ? `${value}，${chip}` : chip))}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{chip}</Text>
              </Pressable>
            ))}
          </View>
          {!concern.trim() ? <Text style={styles.inlineHint}>说出来，我帮你记。</Text> : null}
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={step === 2 ? "帮我记下来" : "好，继续"}
          disabled={!canContinue}
          onPress={next}
          icon={<ChevronRight color="#FFFFFF" size={19} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /* ── Intro carousel ── */
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 32
  },
  brandName: {
    ...typography.label,
    color: colors.brand.primaryDark
  },
  slideContent: {
    flex: 1
  },
  slidePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand.primarySoft,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 20
  },
  slidePillText: {
    ...typography.small,
    fontWeight: "700" as const,
    color: colors.brand.primaryDark
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft,
    marginBottom: 20
  },
  slideTitle: {
    ...typography.pageTitle,
    fontSize: 26,
    lineHeight: 34,
    color: colors.text.primary,
    marginBottom: 16
  },
  slideBody: {
    ...typography.body,
    color: colors.text.secondary,
    lineHeight: 26
  },
  featureList: {
    gap: 0,
    marginTop: 4
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle
  },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft,
    flexShrink: 0
  },
  featureCopy: {
    flex: 1,
    paddingTop: 1
  },
  featureTitle: {
    ...typography.label,
    color: colors.text.primary,
    marginBottom: 3
  },
  featureBody: {
    ...typography.helper,
    color: colors.text.secondary,
    lineHeight: 20
  },
  disclaimer: {
    ...typography.small,
    color: colors.text.muted,
    lineHeight: 18,
    marginTop: 20,
    marginBottom: 4
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 24,
    marginBottom: 20
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border.subtle
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.brand.primary
  },
  introActions: {
    gap: 8
  },

  /* ── Step flow header ── */
  stepHeader: {
    marginTop: 8,
    marginBottom: 16
  },
  stepLogoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  stepLogoText: {
    ...typography.label,
    color: colors.brand.primaryDark
  },
  stepper: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16
  },
  stepSegment: {
    height: 4,
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.border.subtle
  },
  stepSegmentDone: {
    backgroundColor: colors.brand.primarySoft
  },
  stepSegmentActive: {
    backgroundColor: colors.brand.primary
  },
  cardTitle: {
    ...typography.cardTitle,
    color: colors.text.primary
  },
  helper: {
    ...typography.helper,
    color: colors.text.secondary,
    marginTop: 8
  },
  label: {
    ...typography.label,
    color: colors.text.primary,
    marginTop: 16,
    marginBottom: 8
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.muted,
    paddingHorizontal: 14,
    ...typography.body,
    color: colors.text.primary
  },
  textarea: {
    minHeight: 128,
    paddingTop: 12,
    paddingBottom: 12
  },
  textareaSmall: {
    minHeight: 92,
    paddingTop: 12,
    paddingBottom: 12
  },
  uploadBox: {
    minHeight: 72,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.statusSoft.calm,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginTop: 14
  },
  uploadIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)"
  },
  uploadCopy: {
    flex: 1
  },
  uploadTitle: {
    ...typography.label,
    color: colors.text.primary
  },
  uploadSubtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 3
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12
  },
  chip: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft
  },
  chipText: {
    ...typography.small,
    fontWeight: "700",
    color: colors.brand.primaryDark
  },
  chipSelected: {
    backgroundColor: colors.brand.primary
  },
  chipTextSelected: {
    color: colors.text.inverse
  },
  inlineHint: {
    ...typography.small,
    color: colors.status.watch,
    marginTop: 10
  },
  secondaryAction: {
    marginTop: 12
  },
  actions: {
    marginTop: 4
  }
});

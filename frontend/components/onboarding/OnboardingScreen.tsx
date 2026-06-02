import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ChevronRight, HeartHandshake } from "lucide-react-native";
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
  "配偶",
  "婆婆",
  "公公",
  "岳母",
  "岳父"
];
const concernChips = ["夜里起来了", "不肯吃饭", "说有人偷钱", "不肯吃药"];

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

export function OnboardingScreen() {
  const { completeOnboarding } = useCareMind();
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState("");
  const [condition, setCondition] = useState("");
  const [concern, setConcern] = useState("");

  const canContinue = step === 0 ? nickname.trim().length > 0 : step === 2 ? concern.trim().length > 0 : true;

  function next() {
    if (step < 2) {
      setStep((current) => current + 1);
      return;
    }
    completeOnboarding({
      nickname,
      doctorNote: condition,
      concern
    });
    router.replace("/(tabs)/log");
  }

  function skipDoctorNote() {
    setCondition("");
    setStep(2);
  }

  return (
    <Screen bottomInset={32}>
      <View style={styles.heroIcon}>
        <HeartHandshake color={colors.brand.primaryDark} size={30} />
      </View>
      <Text style={styles.title}>你说，我帮你整理</Text>
      <Text style={styles.subtitle}>CareMind 会把照护中的零散记忆整理成可记录、可追踪、可复诊沟通的材料。</Text>

      <StepProgressBar step={step} />

      {step === 0 ? (
        <Card>
          <Text style={styles.cardTitle}>我们怎么称呼 Ta？</Text>
          <Text style={styles.label}>患者昵称</Text>
          <TextInput
            accessibilityLabel="患者昵称"
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
          <Text style={styles.cardTitle}>医生曾经怎么说？</Text>
          <Text style={styles.helper}>这里只记录你填写的信息，CareMind 不会自行判断诊断。</Text>
          <Text style={styles.label}>医生说明或家属记录</Text>
          <TextInput
            accessibilityLabel="医生说过是什么情况"
            multiline
            value={condition}
            onChangeText={setCondition}
            placeholder="可填写，也可以跳过"
            placeholderTextColor={colors.text.muted}
            style={[styles.input, styles.textarea]}
            textAlignVertical="top"
          />
          <View style={styles.secondaryAction}>
            <Button label="跳过这一步" variant="ghost" onPress={skipDoctorNote} />
          </View>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <Text style={styles.cardTitle}>最近最让你担心的是什么？</Text>
          <Text style={styles.helper}>写下来，我帮你整理成第一条照护记录。</Text>
          <Text style={styles.label}>第一条记录</Text>
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
          {!concern.trim() ? <Text style={styles.inlineHint}>请先写下让你担心的事。</Text> : null}
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={step === 2 ? "生成第一条记录" : "继续"}
          disabled={!canContinue}
          onPress={next}
          icon={<ChevronRight color="#FFFFFF" size={19} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroIcon: {
    width: 62,
    height: 62,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft,
    marginTop: 12,
    marginBottom: 18
  },
  title: {
    ...typography.pageTitle,
    color: colors.text.primary
  },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: 8,
    marginBottom: 18
  },
  stepper: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16
  },
  stepSegment: {
    height: 6,
    flex: 1,
    borderRadius: 3,
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

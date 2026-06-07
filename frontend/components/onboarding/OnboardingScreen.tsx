import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Audio } from "expo-av";
import {
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  HeartHandshake,
  HeartPulse,
  MessageSquare,
  Mic,
  Puzzle,
  UploadCloud
} from "lucide-react-native";
import { useCareMind } from "../../lib/caremind-store";
import { transcribeAudioNote } from "../../lib/care-workflow-api";
import { isPrivacyMode } from "../../lib/inference/privacy-mode";
import {
  ANDROID_SPEECH_RECOGNITION_AVAILABLE,
  cancelAndroidSpeechRecognition,
  isAndroidSpeechRecognitionAvailable,
  startAndroidSpeechRecognition,
  stopAndroidSpeechRecognition,
  subscribeAndroidSpeechError,
  subscribeAndroidSpeechResult
} from "../../lib/speech/android-speech";
import { colors, hitSlop, typography } from "../../lib/theme";
import type { AnalyticsEvent } from "../../types/caremind";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";

type VoiceState = "idle" | "listening" | "transcribing" | "unsupported" | "error";

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0?: {
    transcript?: string;
  };
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
};

type BrowserSpeechRecognitionErrorEvent = {
  error?: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

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

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function buildVoiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "麦克风权限被浏览器拒绝。请点地址栏左侧的网站设置，允许麦克风，然后刷新页面再试。";
  }
  if (error === "no-speech") {
    return "没有听到声音，可以靠近一点再试。";
  }
  if (error === "audio-capture") {
    return "没有检测到可用麦克风。";
  }
  return "这次没有成功转成文字，可以再试一次或手动输入。";
}

function ConcernVoiceButton({
  value,
  onChange,
  onTrackVoiceEvent
}: {
  value: string;
  onChange: (value: string) => void;
  onTrackVoiceEvent: (name: "voice_input_started" | "voice_input_succeeded" | "voice_input_failed" | "voice_input_unsupported", properties?: AnalyticsEvent["properties"]) => void;
}) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const latestValueRef = useRef(value);
  const finalTranscriptRef = useRef("");
  const voiceHadErrorRef = useRef(false);
  const nativeStopRequestedRef = useRef(false);
  const androidSpeechStopRequestedRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("idle");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceHint, setVoiceHint] = useState<string | null>(null);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (ANDROID_SPEECH_RECOGNITION_AVAILABLE) {
        void cancelAndroidSpeechRecognition().catch(() => undefined);
      }
      if (recordingRef.current) {
        void recordingRef.current.stopAndUnloadAsync().catch(() => undefined);
        recordingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ANDROID_SPEECH_RECOGNITION_AVAILABLE) return;

    const resultSub = subscribeAndroidSpeechResult((event) => {
      const transcript = event.transcript?.trim() ?? "";
      if (!transcript) return;

      if (event.isFinal) {
        androidSpeechStopRequestedRef.current = false;
        appendTranscript(transcript);
        setVoiceState("idle");
        setVoiceHint("已转成文字，可以继续补充。");
        onTrackVoiceEvent("voice_input_succeeded", {
          platform: Platform.OS,
          entry: "onboarding_concern",
          provider: "android_speech_recognizer",
          transcript_length: transcript.length
        });
      } else {
        setVoiceHint(`正在听：${transcript}`);
      }
    });

    const errorSub = subscribeAndroidSpeechError((event) => {
      androidSpeechStopRequestedRef.current = false;
      setVoiceState("error");
      setVoiceHint(event.message ?? "这次没有成功转成文字，可以再试一次或手动输入。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        provider: "android_speech_recognizer",
        reason: event.message ?? "android_speech_error"
      });
    });

    return () => {
      resultSub.remove();
      errorSub.remove();
    };
  }, []);

  function appendTranscript(transcript: string) {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;

    const current = latestValueRef.current.trim();
    const separator = current && !/[，。！？,.!?]$/.test(current) ? "，" : "";
    onChange(current ? `${current}${separator}${cleanTranscript}` : cleanTranscript);
  }

  function unsupportedVoiceInput() {
    setVoiceState("unsupported");
    setVoiceHint(
      Platform.OS === "web"
        ? "当前浏览器不支持语音转文字。建议用 Chrome / Edge，或先手动输入。"
        : "当前设备暂不支持录音转文字，可以先手动输入。"
    );
    onTrackVoiceEvent("voice_input_unsupported", {
      platform: Platform.OS,
      entry: "onboarding_concern"
    });
  }

  function startWebSpeechInput() {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      unsupportedVoiceInput();
      return;
    }

    recognitionRef.current?.abort();
    finalTranscriptRef.current = "";
    voiceHadErrorRef.current = false;

    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      setVoiceState("listening");
      setVoiceHint("正在听，松手后我会转成文字。");
      onTrackVoiceEvent("voice_input_started", {
        platform: Platform.OS,
        entry: "onboarding_concern"
      });
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current}${finalText}`;
        setVoiceHint(`已听到：${finalTranscriptRef.current.trim()}`);
      } else if (interimText.trim()) {
        setVoiceHint(`正在听：${interimText.trim()}`);
      }
    };

    recognition.onerror = (event) => {
      voiceHadErrorRef.current = true;
      recognitionRef.current = null;
      setVoiceState("error");
      setVoiceHint(buildVoiceErrorMessage(event.error));
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        reason: event.error ?? "unknown"
      });
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (voiceHadErrorRef.current) return;

      const transcript = finalTranscriptRef.current.trim();
      if (transcript) {
        appendTranscript(transcript);
        setVoiceHint("已转成文字，可以继续补充。");
        onTrackVoiceEvent("voice_input_succeeded", {
          platform: Platform.OS,
          entry: "onboarding_concern",
          transcript_length: transcript.length
        });
      } else {
        setVoiceHint("没有听到清楚内容，可以再按住说一次。");
      }
      setVoiceState("idle");
    };

    recognitionRef.current = recognition;
    setVoiceState("listening");
    setVoiceHint("正在请求麦克风权限……");

    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setVoiceState("error");
      setVoiceHint("语音识别没有启动成功，可以刷新页面后再试。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        reason: error instanceof Error ? error.message : "start_failed"
      });
    }
  }

  function stopWebSpeechInput() {
    if (!recognitionRef.current) return;
    setVoiceHint("正在转成文字……");
    try {
      recognitionRef.current.stop();
    } catch {
      recognitionRef.current = null;
      setVoiceState("idle");
    }
  }

  async function startNativeRecording() {
    if (recordingRef.current || voiceState === "transcribing") return;

    nativeStopRequestedRef.current = false;
    setVoiceState("listening");
    setVoiceHint("正在请求麦克风权限……");

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceState("error");
        setVoiceHint("没有麦克风权限，请在系统设置里允许 CareMind 使用麦克风。");
        onTrackVoiceEvent("voice_input_failed", {
          platform: Platform.OS,
          entry: "onboarding_concern",
          reason: "microphone_permission_denied"
        });
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setVoiceHint("正在录音，松手后我会转成文字。");
      onTrackVoiceEvent("voice_input_started", {
        platform: Platform.OS,
        entry: "onboarding_concern"
      });

      if (nativeStopRequestedRef.current) {
        await stopNativeRecording();
      }
    } catch (error) {
      recordingRef.current = null;
      nativeStopRequestedRef.current = false;
      setVoiceState("error");
      setVoiceHint("录音没有启动成功，可以检查麦克风权限后再试。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        reason: error instanceof Error ? error.message : "recording_start_failed"
      });
    }
  }

  async function startAndroidSpeechInput() {
    if (voiceStateRef.current === "transcribing") return;

    androidSpeechStopRequestedRef.current = false;
    setVoiceState("listening");
    setVoiceHint("正在请求麦克风权限……");

    try {
      if (await isPrivacyMode()) {
        setVoiceState("unsupported");
        setVoiceHint("隐私模式下暂不启用语音转文字。你可以先手动输入，或关闭隐私模式后使用系统语音识别。");
        onTrackVoiceEvent("voice_input_unsupported", {
          platform: Platform.OS,
          entry: "onboarding_concern",
          reason: "privacy_mode_audio_disabled"
        });
        return;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceState("error");
        setVoiceHint("没有麦克风权限，请在系统设置里允许 CareMind 使用麦克风。");
        onTrackVoiceEvent("voice_input_failed", {
          platform: Platform.OS,
          entry: "onboarding_concern",
          reason: "microphone_permission_denied"
        });
        return;
      }

      const available = await isAndroidSpeechRecognitionAvailable();
      if (!available) {
        unsupportedVoiceInput();
        return;
      }

      await startAndroidSpeechRecognition("zh-CN");
      setVoiceHint("正在听，松手后我会转成文字。");
      onTrackVoiceEvent("voice_input_started", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        provider: "android_speech_recognizer"
      });

      if (androidSpeechStopRequestedRef.current) {
        await stopAndroidSpeechInput();
      }
    } catch (error) {
      androidSpeechStopRequestedRef.current = false;
      setVoiceState("error");
      setVoiceHint(error instanceof Error ? error.message : "语音识别没有启动成功，可以先手动输入。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        provider: "android_speech_recognizer",
        reason: error instanceof Error ? error.message : "android_speech_start_failed"
      });
    }
  }

  async function stopAndroidSpeechInput() {
    if (voiceStateRef.current !== "listening") {
      androidSpeechStopRequestedRef.current = true;
      return;
    }

    setVoiceState("transcribing");
    setVoiceHint("正在转成文字……");

    try {
      await stopAndroidSpeechRecognition();
    } catch (error) {
      androidSpeechStopRequestedRef.current = false;
      setVoiceState("error");
      setVoiceHint(error instanceof Error ? error.message : "语音识别停止失败，可以先手动输入。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        provider: "android_speech_recognizer",
        reason: error instanceof Error ? error.message : "android_speech_stop_failed"
      });
    }
  }

  async function stopNativeRecording() {
    const recording = recordingRef.current;
    if (!recording) {
      nativeStopRequestedRef.current = true;
      return;
    }

    recordingRef.current = null;
    nativeStopRequestedRef.current = false;
    setVoiceState("transcribing");
    setVoiceHint("正在上传并转成文字……");

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true
      });

      const uri = recording.getURI();
      if (!uri) {
        throw new Error("recording_uri_missing");
      }

      const result = await transcribeAudioNote({
        patientId: "onboarding_patient",
        language: "zh",
        asset: {
          uri,
          name: `caremind_onboarding_${Date.now()}.m4a`,
          mimeType: "audio/m4a"
        }
      });

      appendTranscript(result.transcript);
      setVoiceState("idle");
      setVoiceHint("已转成文字，可以继续补充。");
      onTrackVoiceEvent("voice_input_succeeded", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        transcript_length: result.transcript.length
      });
    } catch (error) {
      setVoiceState("error");
      setVoiceHint(error instanceof Error ? error.message : "语音转文字失败，可以再试一次或手动输入。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        entry: "onboarding_concern",
        reason: error instanceof Error ? error.message : "native_transcription_failed"
      });
    }
  }

  function startVoiceInput() {
    if (Platform.OS === "web") {
      startWebSpeechInput();
      return;
    }
    if (Platform.OS === "android") {
      void startAndroidSpeechInput();
      return;
    }
    void startNativeRecording();
  }

  function stopVoiceInput() {
    if (Platform.OS === "web") {
      stopWebSpeechInput();
      return;
    }
    if (Platform.OS === "android") {
      void stopAndroidSpeechInput();
      return;
    }
    void stopNativeRecording();
  }

  const voiceActive = voiceState === "listening" || voiceState === "transcribing";
  const voiceUnavailable = voiceState === "unsupported" || voiceState === "error";
  const voiceLabel = voiceState === "listening" ? "正在听" : voiceState === "transcribing" ? "转写中" : "按住说话";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="按住说话，松手结束"
        accessibilityState={{ busy: voiceActive }}
        hitSlop={hitSlop}
        onPressIn={startVoiceInput}
        onPressOut={stopVoiceInput}
        style={({ pressed }) => [
          styles.voiceButton,
          voiceActive && styles.voiceButtonActive,
          voiceUnavailable && styles.voiceButtonUnavailable,
          pressed && styles.voiceButtonPressed
        ]}
      >
        <Mic color={voiceActive ? colors.text.inverse : voiceUnavailable ? colors.status.watch : colors.text.secondary} size={18} />
        <Text style={[styles.voiceText, voiceActive && styles.voiceTextActive, voiceUnavailable && styles.voiceTextUnavailable]}>
          {voiceLabel}
        </Text>
      </Pressable>
      {voiceHint ? <Text style={[styles.voiceHint, voiceUnavailable && styles.voiceHintWarning]}>{voiceHint}</Text> : null}
    </>
  );
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
    pill: "家庭照护导航",
    title: "把每天的照护，\n分成六件小事",
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
    icon: ClipboardList,
    title: "记录整理",
    body: "一句话整理成睡眠、行为、饮食、用药记录。"
  },
  {
    icon: Eye,
    title: "今日行动",
    body: "提示今晚最该关注的事，附上能做到的小行动。"
  },
  {
    icon: MessageSquare,
    title: "沟通话术",
    body: "遇到“有人偷钱”“要回家”，给出低冲突回应。"
  },
  {
    icon: Puzzle,
    title: "陪伴活动",
    body: "照片、老歌、配对/分类小游戏，记录参与反应。"
  },
  {
    icon: UploadCloud,
    title: "资料复诊",
    body: "病历、检查、用药清单，汇入复诊摘要。"
  },
  {
    icon: HeartPulse,
    title: "照护者支持",
    body: "记录压力和疲惫，提醒休息与家人轮替。"
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

function IntroCarousel({ onDone }: { onDone: () => void }) {
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
          <Button
            label="开始设置"
            onPress={onDone}
            icon={<ChevronRight color="#FFFFFF" size={19} />}
          />
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
  const { completeOnboarding, trackEvent } = useCareMind();
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

  if (!landed) {
    return <IntroCarousel onDone={() => setLanded(true)} />;
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
          <ConcernVoiceButton value={concern} onChange={setConcern} onTrackVoiceEvent={trackEvent} />
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
    marginBottom: 28
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
    backgroundColor: colors.surface.info,
    borderWidth: 1,
    borderColor: "#E7CBB0",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 20
  },
  slidePillText: {
    ...typography.small,
    fontWeight: "700" as const,
    color: colors.brand.warm
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: "#CFE4D2",
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
    marginTop: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,248,0.72)",
    overflow: "hidden"
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
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
    lineHeight: 19
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
    backgroundColor: "rgba(255,253,248,0.72)",
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
    backgroundColor: colors.surface.info,
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
    backgroundColor: "rgba(255,253,248,0.74)"
  },
  uploadCopy: {
    flex: 1
  },
  uploadTitle: {
    ...typography.label,
    color: colors.text.primary
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
    backgroundColor: "rgba(255,253,248,0.72)",
    borderWidth: 1,
    borderColor: colors.border.subtle
  },
  chipText: {
    ...typography.small,
    fontWeight: "700",
    color: colors.text.secondary
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
  voiceButton: {
    minHeight: 46,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.surface.muted,
    marginTop: 12
  },
  voiceButtonActive: {
    backgroundColor: colors.brand.primary
  },
  voiceButtonUnavailable: {
    backgroundColor: colors.statusSoft.watch
  },
  voiceButtonPressed: {
    opacity: 0.88
  },
  voiceText: {
    ...typography.label,
    color: colors.text.secondary
  },
  voiceTextActive: {
    color: colors.text.inverse
  },
  voiceTextUnavailable: {
    color: colors.status.watch
  },
  voiceHint: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 8
  },
  voiceHintWarning: {
    color: colors.status.watch
  },
  secondaryAction: {
    marginTop: 12
  },
  actions: {
    marginTop: 4
  }
});

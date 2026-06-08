import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import {
  Check,
  ChevronRight,
  Clock,
  ClipboardList,
  Mic,
  Play,
  Volume2,
  X
} from "lucide-react-native";
import { useCareMind } from "../../lib/caremind-store";
import { runCareWorkflow, transcribeAudioNote } from "../../lib/care-workflow-api";
import { isPrivacyMode } from "../../lib/inference/privacy-mode";
import { selectionHaptic, successHaptic } from "../../lib/safe-haptics";
import {
  ANDROID_SPEECH_RECOGNITION_AVAILABLE,
  cancelAndroidSpeechRecognition,
  isAndroidSpeechRecognitionAvailable,
  startAndroidSpeechRecognition,
  stopAndroidSpeechRecognition,
  subscribeAndroidSpeechError,
  subscribeAndroidSpeechResult
} from "../../lib/speech/android-speech";
import { colors, hitSlop, shadow, typography } from "../../lib/theme";
import type { AnalyticsEvent, AttentionItem, MemoryItem, StructuredLog } from "../../types/caremind";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageHeader } from "../ui/PageHeader";
import { Screen } from "../ui/Screen";
import { MemoryCandidateCard } from "../memory/MemoryCandidateCard";
import { MemoryUsedPill } from "../memory/MemoryUsedPill";
import { SimilarEventCard } from "../memory/SimilarEventCard";

type ParseState = "idle" | "parsing" | "parsed" | "saved";
type SummaryField = "sleep" | "behavior" | "nutrition" | "caregiver";
type VoiceState = "idle" | "listening" | "transcribing" | "unsupported" | "error";
type ScriptAdvice = {
  notRecommended: string;
  recommended: string;
  principle: string;
};

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
  message?: string;
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

const progressSteps = ["整理今天发生的事", "找出值得留意的地方", "生成沟通建议", "记住有用的照护方式"];
const medicalKeywords = /诊断|停药|换药|加药|减药|补药|MRI|CT|核磁|检查|处方|药量/;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (error === "network") {
    return "语音识别网络暂时不可用，可以先手动输入。";
  }
  return "这次没有成功转成文字，可以再试一次或手动输入。";
}

function formatHeaderDateTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date())
    .replace(/\//g, "-");
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateInput(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTimeInput(iso: string) {
  const date = new Date(iso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseDateTimeInput(dateText: string, timeText: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) {
    return null;
  }
  const parsed = new Date(`${dateText}T${timeText}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatEventDateTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date(iso))
    .replace(/\//g, "-");
}

function MedicalBoundaryBubble({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.boundaryBubble}>
      <Text style={styles.boundaryBubbleText}>我不能判断诊断或用药，但可以帮你整理成复诊时医生容易理解的问题。</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭医疗边界提示" hitSlop={hitSlop} onPress={onClose} style={styles.bubbleClose}>
        <X color={colors.status.info} size={18} />
      </Pressable>
    </View>
  );
}

function EventTimeButton({ eventAt, onChange }: { eventAt: string; onChange: (next: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [dateDraft, setDateDraft] = useState(formatDateInput(eventAt));
  const [timeDraft, setTimeDraft] = useState(formatTimeInput(eventAt));
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDateDraft(formatDateInput(eventAt));
    setTimeDraft(formatTimeInput(eventAt));
    setError(null);
    setVisible(true);
  }

  function save() {
    const next = parseDateTimeInput(dateDraft.trim(), timeDraft.trim());
    if (!next) {
      setError("请按 YYYY-MM-DD 和 HH:mm 填写。");
      return;
    }
    Keyboard.dismiss();
    onChange(next);
    setVisible(false);
  }

  function setNow() {
    const now = new Date().toISOString();
    setDateDraft(formatDateInput(now));
    setTimeDraft(formatTimeInput(now));
    onChange(now);
  }

  return (
    <>
      <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={open} style={styles.eventTimeButton}>
        <View style={styles.eventTimeIcon}>
          <Clock color={colors.brand.primaryDark} size={18} />
        </View>
        <View style={styles.eventTimeCopy}>
          <Text style={styles.eventTimeLabel}>发生时间</Text>
          <Text style={styles.eventTimeValue}>{formatEventDateTime(eventAt)}</Text>
        </View>
        <Text style={styles.eventTimeEdit}>修改</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>选择记录发生时间</Text>
            <Text style={styles.body}>如果只是大概时间，也可以先填接近的时间，之后再修改。</Text>
            <Text style={styles.label}>日期</Text>
            <TextInput
              accessibilityLabel="发生日期"
              value={dateDraft}
              onChangeText={setDateDraft}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.text.muted}
              style={styles.compactInput}
            />
            <Text style={styles.label}>时间</Text>
            <TextInput
              accessibilityLabel="发生时间"
              value={timeDraft}
              onChangeText={setTimeDraft}
              placeholder="HH:mm"
              placeholderTextColor={colors.text.muted}
              style={styles.compactInput}
            />
            {error ? <Text style={styles.inputError}>{error}</Text> : null}
            <View style={styles.sheetActions}>
              <Button label="保存时间" onPress={save} />
              <Button label="设为现在" variant="secondary" onPress={setNow} />
              <Button label="取消" variant="ghost" onPress={() => setVisible(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function MagicLogInput({
  value,
  onChange,
  onParse,
  onTrackVoiceEvent,
  eventAt,
  onChangeEventAt,
  parseState,
  showBoundary,
  onDismissBoundary,
  error,
  patientId,
  nickname
}: {
  value: string;
  onChange: (value: string) => void;
  onParse: () => void;
  onTrackVoiceEvent: (name: "voice_input_started" | "voice_input_succeeded" | "voice_input_failed" | "voice_input_unsupported", properties?: AnalyticsEvent["properties"]) => void;
  eventAt: string;
  onChangeEventAt: (next: string) => void;
  parseState: ParseState;
  showBoundary: boolean;
  onDismissBoundary: () => void;
  error: string | null;
  patientId: string;
  nickname: string;
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
        setVoiceHint("已转成文字，你可以继续补充或点“帮我整理”。");
        onTrackVoiceEvent("voice_input_succeeded", {
          platform: Platform.OS,
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
      platform: Platform.OS
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
      onTrackVoiceEvent("voice_input_started", { platform: Platform.OS });
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
        reason: event.error ?? "unknown"
      });
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (voiceHadErrorRef.current) return;

      const transcript = finalTranscriptRef.current.trim();
      if (transcript) {
        appendTranscript(transcript);
        setVoiceHint("已转成文字，你可以继续补充或点“帮我整理”。");
        onTrackVoiceEvent("voice_input_succeeded", {
          platform: Platform.OS,
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
      onTrackVoiceEvent("voice_input_started", { platform: Platform.OS });

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
        patientId,
        language: "zh",
        asset: {
          uri,
          name: `caremind_voice_${Date.now()}.m4a`,
          mimeType: "audio/m4a"
        }
      });

      appendTranscript(result.transcript);
      setVoiceState("idle");
      setVoiceHint("已转成文字，你可以继续补充或点“帮我整理”。");
      onTrackVoiceEvent("voice_input_succeeded", {
        platform: Platform.OS,
        transcript_length: result.transcript.length
      });
    } catch (error) {
      setVoiceState("error");
      setVoiceHint(error instanceof Error ? error.message : "语音转文字失败，可以再试一次或手动输入。");
      onTrackVoiceEvent("voice_input_failed", {
        platform: Platform.OS,
        reason: error instanceof Error ? error.message : "native_transcription_failed"
      });
    }
  }

  function startVoiceInput() {
    if (parseState === "parsing") return;
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
    <Card tone="brand">
      <Text style={styles.cardTitle}>今天 {nickname} 有什么让你担心的事吗？</Text>
      <Text style={styles.body}>写一句话就够了，也可以直接粘贴家属聊天记录。</Text>
      <EventTimeButton eventAt={eventAt} onChange={onChangeEventAt} />
      {showBoundary ? <MedicalBoundaryBubble onClose={onDismissBoundary} /> : null}
      <TextInput
        accessibilityLabel="输入今天发生了什么"
        editable={parseState !== "parsing"}
        multiline
        value={value}
        onChangeText={onChange}
        maxLength={1000}
        placeholder=""
        placeholderTextColor={colors.text.muted}
        style={[styles.textInput, parseState === "parsing" && styles.textInputDisabled]}
        textAlignVertical="top"
      />
      <View style={styles.inputMetaRow}>
        <Text style={styles.inputError}>{error ?? ""}</Text>
        {value.length > 800 ? <Text style={styles.charCount}>{value.length} / 1000</Text> : null}
      </View>
      <View style={styles.inputActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="按住说话，松手结束"
          accessibilityState={{ busy: voiceActive, disabled: parseState === "parsing" }}
          hitSlop={hitSlop}
          disabled={parseState === "parsing"}
          onPressIn={startVoiceInput}
          onPressOut={stopVoiceInput}
          style={({ pressed }) => [
            styles.voiceButton,
            voiceActive && styles.voiceButtonActive,
            voiceUnavailable && styles.voiceButtonUnavailable,
            pressed && styles.voiceButtonPressed
          ]}
        >
          <Mic color={voiceActive ? colors.text.inverse : voiceUnavailable ? colors.status.watch : colors.text.secondary} size={20} />
          <Text style={[styles.voiceText, voiceActive && styles.voiceTextActive, voiceUnavailable && styles.voiceTextUnavailable]}>
            {voiceLabel}
          </Text>
        </Pressable>
        <View style={styles.parseButton}>
          <Button label="帮我整理" loading={parseState === "parsing"} onPress={onParse} />
        </View>
      </View>
      {voiceHint ? (
        <Text style={[styles.voiceHint, voiceUnavailable && styles.voiceHintWarning]}>{voiceHint}</Text>
      ) : null}
    </Card>
  );
}

function AgentProgressCard({ completedSteps }: { completedSteps: number }) {
  return (
    <Card tone="default">
      <View style={styles.headerRow}>
        <ActivityIndicator size={18} color={colors.brand.primary} />
        <Text style={styles.cardTitle}>我来帮你整理……</Text>
      </View>
      <View style={styles.progressList}>
        {progressSteps.map((step, index) => {
          const done = index < completedSteps;
          const active = index === completedSteps;
          return (
            <View key={step} style={styles.progressRow}>
              <View style={[styles.progressDot, done && styles.progressDotDone, active && styles.progressDotActive]}>
                {done ? <Check color="#FFFFFF" size={12} /> : null}
              </View>
              <Text style={[styles.progressText, done && styles.progressTextDone]}>{step}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function formatStructuredLog(structuredLog: StructuredLog) {
  const behavior = structuredLog.behavior[0];
  return {
    sleep:
      structuredLog.sleep.nightWakings === null
        ? structuredLog.sleep.note || "未提到夜间起床次数"
        : `夜间起床 ${structuredLog.sleep.nightWakings} 次`,
    behavior: behavior?.label ?? "未提到明显行为变化",
    nutrition: structuredLog.nutrition.note,
    caregiver: structuredLog.caregiver.quote ? `表达“${structuredLog.caregiver.quote}”` : "未提到照护者压力"
  };
}

function StructuredSummaryCard({
  structuredLog,
  onChange
}: {
  structuredLog: StructuredLog;
  onChange: (next: StructuredLog) => void;
}) {
  const rows = formatStructuredLog(structuredLog);
  const [editingField, setEditingField] = useState<SummaryField | null>(null);
  const [draftValue, setDraftValue] = useState("");

  function openEdit(field: SummaryField) {
    setEditingField(field);
    setDraftValue(rows[field]);
  }

  function markUnknown() {
    if (!editingField) return;
    saveField("未知");
  }

  function saveField(value = draftValue.trim()) {
    if (!editingField) return;
    const finalValue = value || "未知";
    const next: StructuredLog = {
      ...structuredLog,
      sleep: { ...structuredLog.sleep },
      behavior: [...structuredLog.behavior],
      nutrition: { ...structuredLog.nutrition },
      caregiver: { ...structuredLog.caregiver }
    };

    if (editingField === "sleep") {
      const numberMatch = finalValue.match(/(\d+)/);
      next.sleep = {
        nightWakings: numberMatch ? Number(numberMatch[1]) : null,
        note: finalValue
      };
    }

    if (editingField === "behavior") {
      next.behavior = finalValue === "未知" ? [] : [{ label: finalValue, evidence: "用户编辑确认", frequency: "已确认" }];
    }

    if (editingField === "nutrition") {
      next.nutrition = {
        ...structuredLog.nutrition,
        mealIntake: finalValue === "未知" ? "unknown" : structuredLog.nutrition.mealIntake,
        note: finalValue
      };
    }

    if (editingField === "caregiver") {
      next.caregiver = {
        quote: finalValue === "未知" ? "" : finalValue,
        stressSignal: finalValue !== "未知"
      };
    }

    onChange(next);
    setEditingField(null);
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <ClipboardList color={colors.brand.primaryDark} size={20} />
        <Text style={styles.cardTitle}>今天记录的内容</Text>
      </View>
      <View style={styles.summaryGrid}>
        <SummaryRow label="睡眠" value={rows.sleep} uncertain={structuredLog.sleep.nightWakings === null} onPress={() => openEdit("sleep")} />
        <SummaryRow label="行为" value={rows.behavior} uncertain={structuredLog.behavior.length === 0} onPress={() => openEdit("behavior")} />
        <SummaryRow label="饮食" value={rows.nutrition} uncertain={structuredLog.nutrition.mealIntake === "unknown"} onPress={() => openEdit("nutrition")} />
        <SummaryRow label="照护者" value={rows.caregiver} uncertain={!structuredLog.caregiver.stressSignal} onPress={() => openEdit("caregiver")} />
      </View>
      <Text style={styles.boundaryText}>这些是照护记录整理，不是诊断。你可以在保存前修改每个字段。</Text>

      <Modal visible={editingField !== null} transparent animationType="slide" onRequestClose={() => setEditingField(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>修改字段</Text>
            <TextInput
              accessibilityLabel="修改结构化字段"
              value={draftValue}
              onChangeText={setDraftValue}
              multiline
              style={[styles.textInput, styles.editInput]}
              textAlignVertical="top"
            />
            <View style={styles.sheetActions}>
              <Button label="保存修改" onPress={() => saveField()} />
              <Button label="标记为未知" variant="secondary" onPress={markUnknown} />
              <Button label="取消" variant="ghost" onPress={() => setEditingField(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  uncertain,
  onPress
}: {
  label: string;
  value: string;
  uncertain: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={onPress} style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      {uncertain ? (
        <View style={styles.uncertainBadge}>
          <Text style={styles.uncertainText}>待确认</Text>
        </View>
      ) : null}
      <ChevronRight color={colors.text.muted} size={16} />
    </Pressable>
  );
}

function AttentionPreviewCard() {
  return (
    <Card tone="watch">
      <Text style={styles.cardTitle}>今晚值得注意</Text>
      <Text style={styles.body}>我已经把这条记录同步到“今日照护”，那里会展示可勾选的行动建议。</Text>
      <View style={styles.speechButton}>
        <Button label="去今日照护查看" variant="secondary" onPress={() => router.push("/(tabs)/today")} />
      </View>
    </Card>
  );
}

function InstantScriptCard({ advice }: { advice: ScriptAdvice }) {
  function speak() {
    Speech.stop();
    Speech.speak(advice.recommended, { language: "zh-CN", pitch: 1.0, rate: 0.85 });
  }

  return (
    <Card>
      <View style={styles.headerRow}>
        <Volume2 color={colors.status.info} size={20} />
        <Text style={styles.cardTitle}>现在可以这样回应</Text>
      </View>
      <View style={styles.badScript}>
        <Text style={styles.badScriptLabel}>不建议说</Text>
        <Text style={styles.scriptText}>“{advice.notRecommended}”</Text>
      </View>
      <View style={styles.goodScript}>
        <Text style={styles.goodScriptLabel}>可以试着说</Text>
        <Text style={styles.scriptText}>“{advice.recommended}”</Text>
        <View style={styles.speechButton}>
          <Button label="播放这句话" variant="secondary" icon={<Play color={colors.brand.primaryDark} size={18} />} onPress={speak} />
        </View>
      </View>
      <Text style={styles.body}>原则：{advice.principle}</Text>
    </Card>
  );
}

function MilestoneToast({ text }: { text: string }) {
  return (
    <View style={styles.toastWrap} pointerEvents="none">
      <View style={styles.toast}>
        <View style={styles.toastDot} />
        <Text style={styles.toastText}>{text}</Text>
      </View>
    </View>
  );
}

export function SmartLogScreen() {
  const {
    patient,
    memoryItems,
    recordCount,
    previewStructuredLog,
    previewMemoryCandidate,
    saveLog,
    trackEvent
  } = useCareMind();
  const [value, setValue] = useState("");
  const [eventAt, setEventAt] = useState(new Date().toISOString());
  const [parseState, setParseState] = useState<ParseState>("idle");
  const [parsedLog, setParsedLog] = useState<StructuredLog | null>(null);
  const [workflowAttentionItems, setWorkflowAttentionItems] = useState<AttentionItem[]>([]);
  const [workflowMemoryItems, setWorkflowMemoryItems] = useState<MemoryItem[]>([]);
  const [workflowScriptAdvice, setWorkflowScriptAdvice] = useState<ScriptAdvice | null>(null);
  const [candidate, setCandidate] = useState<MemoryItem | null>(null);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const [boundaryDismissed, setBoundaryDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const headerDateTime = useMemo(() => formatHeaderDateTime(), []);
  const similarMemory = useMemo(() => memoryItems.find((item) => item.status === "confirmed"), [memoryItems]);
  const scriptAdvice = workflowScriptAdvice ?? (parsedLog ? buildScriptAdvice(value, parsedLog) : null);
  const showBoundary = !boundaryDismissed && medicalKeywords.test(value);

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 3000);
  }

  async function parse() {
    if (!value.trim()) {
      setInputError("先写下今天发生了什么。");
      return;
    }

    setInputError(null);
    setParseState("parsing");
    setCompletedSteps(0);
    await selectionHaptic();

    for (let index = 1; index <= progressSteps.length; index += 1) {
      await wait(160);
      setCompletedSteps(index);
    }

    try {
      const result = await runCareWorkflow({
        patient_id: patient.id,
        caregiver_id: "local_caregiver",
        note: value.trim(),
        source: "manual",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Shanghai"
      });
      const structured = result.structuredLog ?? previewStructuredLog(value);
      setParsedLog(structured);
      setWorkflowAttentionItems(result.attentionItems);
      setWorkflowMemoryItems(result.memoryItems);
      setWorkflowScriptAdvice(result.scriptAdvice);
      setCandidate(result.memoryItems[0] ?? previewMemoryCandidate(value));
      trackEvent("care_log_ai_parse_succeeded", {
        platform: Platform.OS,
        attention_count: result.attentionItems.length,
        memory_candidate_count: result.memoryItems.length
      });
    } catch (error) {
      console.warn("CareMind workflow parse failed, using local preview", error);
      const fallbackMemory = previewMemoryCandidate(value);
      setParsedLog(previewStructuredLog(value));
      setWorkflowAttentionItems([]);
      setWorkflowMemoryItems(fallbackMemory ? [fallbackMemory] : []);
      setWorkflowScriptAdvice(null);
      setCandidate(fallbackMemory);
      trackEvent("care_log_ai_parse_failed", {
        platform: Platform.OS,
        reason: error instanceof Error ? error.message : "unknown"
      });
    }
    setParseState("parsed");
  }

  async function save() {
    if (!parsedLog) return;
    saveLog(value, parsedLog, {
      occurredAt: eventAt,
      attentionItems: workflowAttentionItems.length > 0 ? workflowAttentionItems : undefined,
      memoryItems: workflowMemoryItems.length > 0 ? workflowMemoryItems : undefined
    });
    setParseState("saved");
    await successHaptic();
    showToast(recordCount === 0 ? `你帮 ${patient.nickname} 记录了第一个重要信息。` : "已保存，复诊摘要会同步更新。");
  }

  function resetInput() {
    setValue("");
    setParsedLog(null);
    setWorkflowAttentionItems([]);
    setWorkflowMemoryItems([]);
    setWorkflowScriptAdvice(null);
    setCandidate(null);
    setCompletedSteps(0);
    setInputError(null);
    setEventAt(new Date().toISOString());
    setParseState("idle");
  }

  return (
    <Screen>
      <PageHeader title="智能记录" subtitle={headerDateTime} />
      {toast ? <MilestoneToast text={toast} /> : null}

      {parseState !== "saved" ? (
        <MagicLogInput
          value={value}
          onChange={(next) => {
            setValue(next);
            setInputError(null);
          }}
          onParse={parse}
          onTrackVoiceEvent={trackEvent}
          eventAt={eventAt}
          onChangeEventAt={setEventAt}
          parseState={parseState}
          showBoundary={showBoundary}
          onDismissBoundary={() => setBoundaryDismissed(true)}
          error={inputError}
          patientId={patient.id}
          nickname={patient.nickname}
        />
      ) : null}
      {parseState === "parsing" ? <AgentProgressCard completedSteps={completedSteps} /> : null}
      {(parseState === "parsed" || parseState === "saved") && parsedLog ? (
        <>
          {memoryItems.length > 0 ? <MemoryUsedPill label="已参考已记住的信息" /> : null}
          <View style={styles.spacer} />
          <StructuredSummaryCard structuredLog={parsedLog} onChange={setParsedLog} />
          {parseState === "saved" ? <AttentionPreviewCard /> : null}
          {similarMemory ? (
            <SimilarEventCard date="已记住的信息" title={similarMemory.title} description={similarMemory.description} />
          ) : null}
          {scriptAdvice ? <InstantScriptCard advice={scriptAdvice} /> : null}
          {candidate ? <MemoryCandidateCard item={candidate} /> : null}
          <View style={styles.saveActions}>
            <Button label={parseState === "saved" ? "再记一条" : "写入日志"} onPress={parseState === "saved" ? resetInput : save} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function buildScriptAdvice(note: string, structuredLog: StructuredLog): ScriptAdvice | null {
  const behavior = structuredLog.behavior[0]?.label ?? "";

  if (/偷|钱|丢/.test(note) || behavior.includes("物品")) {
    return {
      notRecommended: "没人偷，你别乱想。",
      recommended: "你是不是很担心？我陪你一起找找。",
      principle: "先回应担心，再陪伴确认，避免直接否定和争辩。"
    };
  }

  if (/要回家|回老家/.test(note) || behavior.includes("想回家")) {
    return {
      notRecommended: "这里就是家，你别再说了。",
      recommended: "你是不是有点想家？我们先坐一下，我陪你慢慢说。",
      principle: "先接住情绪，再用安全的陪伴动作转移注意力。"
    };
  }

  if (/拒药|不吃药|服药/.test(note)) {
    return {
      notRecommended: "你必须现在吃，不吃不行。",
      recommended: "我知道你现在不想吃，我们先歇一下，等你舒服点再看看。",
      principle: "降低对抗，记录拒药场景，不自行补药或调整剂量。"
    };
  }

  if (/不肯吃|不吃饭|吃得很少|饭/.test(note)) {
    return {
      notRecommended: "你怎么又不吃饭？",
      recommended: "我们先吃两口软一点的，吃不下也没关系，我陪着你。",
      principle: "减少压力，记录摄入量；如果持续少食或呛咳，应咨询医生或营养师。"
    };
  }

  return null;
}

const styles = StyleSheet.create({
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
  boundaryBubble: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.statusSoft.info,
    borderWidth: 1,
    borderColor: "#C9D8E2",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14
  },
  boundaryBubbleText: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  bubbleClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,253,248,0.74)"
  },
  eventTimeButton: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,248,0.74)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    marginTop: 14
  },
  eventTimeIcon: {
    width: 34,
    height: 34,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,253,248,0.74)"
  },
  eventTimeCopy: {
    flex: 1
  },
  eventTimeLabel: {
    ...typography.small,
    color: colors.brand.primaryDark,
    fontWeight: "800"
  },
  eventTimeValue: {
    ...typography.helper,
    color: colors.text.primary,
    marginTop: 2
  },
  eventTimeEdit: {
    ...typography.label,
    color: colors.brand.primaryDark
  },
  textInput: {
    minHeight: 138,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: "rgba(255,253,248,0.78)",
    padding: 14,
    marginTop: 14,
    ...typography.body,
    color: colors.text.primary
  },
  textInputDisabled: {
    opacity: 0.72
  },
  inputMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8
  },
  inputError: {
    ...typography.small,
    color: colors.status.watch,
    flex: 1
  },
  label: {
    ...typography.label,
    color: colors.text.primary,
    marginTop: 14,
    marginBottom: 8
  },
  compactInput: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.card,
    paddingHorizontal: 14,
    ...typography.body,
    color: colors.text.primary
  },
  charCount: {
    ...typography.small,
    color: colors.text.muted
  },
  inputActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14
  },
  voiceButton: {
    minHeight: 52,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,253,248,0.76)",
    borderWidth: 1,
    borderColor: colors.border.subtle
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
    marginTop: 10
  },
  voiceHintWarning: {
    color: colors.status.watch
  },
  parseButton: {
    flex: 1
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  progressList: {
    marginTop: 14,
    gap: 10
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.border.subtle
  },
  progressDotDone: {
    backgroundColor: colors.brand.primary
  },
  progressDotActive: {
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.brand.primary
  },
  progressText: {
    ...typography.helper,
    color: colors.text.secondary
  },
  progressTextDone: {
    color: colors.text.muted
  },
  summaryGrid: {
    marginTop: 14,
    gap: 8
  },
  summaryRow: {
    minHeight: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface.muted,
    paddingHorizontal: 12
  },
  summaryLabel: {
    ...typography.helper,
    width: 56,
    color: colors.text.muted,
    fontWeight: "400" as const
  },
  summaryValue: {
    ...typography.helper,
    color: colors.text.primary,
    flex: 1
  },
  uncertainBadge: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.statusSoft.watch
  },
  uncertainText: {
    ...typography.small,
    fontWeight: "800",
    color: colors.status.watch
  },
  boundaryText: {
    ...typography.small,
    color: colors.text.muted,
    marginTop: 10
  },
  badScript: {
    borderRadius: 14,
    padding: 12,
    paddingLeft: 14,
    backgroundColor: colors.surface.muted,
    marginTop: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.border.strong
  },
  goodScript: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.statusSoft.calm,
    marginTop: 10
  },
  badScriptLabel: {
    ...typography.small,
    fontWeight: "600" as const,
    color: colors.text.muted
  },
  goodScriptLabel: {
    ...typography.small,
    fontWeight: "800",
    color: colors.brand.primaryDark
  },
  scriptText: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: 5
  },
  speechButton: {
    marginTop: 12
  },
  spacer: {
    height: 12
  },
  saveActions: {
    marginTop: 4,
    marginBottom: 12
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(31,41,51,0.28)"
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: colors.surface.card,
    ...shadow.sheet
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
  editInput: {
    minHeight: 112
  },
  sheetActions: {
    gap: 8,
    marginTop: 12
  },
  toastWrap: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 100,
    alignItems: "center"
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 20,
    backgroundColor: colors.surface.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    ...shadow.card
  },
  toastDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.primary
  },
  toastText: {
    ...typography.helper,
    fontWeight: "500" as const,
    color: colors.text.primary,
    flex: 1
  }
});

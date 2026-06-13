import * as FileSystem from "expo-file-system";
import JSZip from "jszip";
import type {
  FollowupDocumentInputModality,
  FollowupDocumentParseQuality,
  FollowupDocumentParseResult
} from "../types/caremind";

export interface PickedFollowupAsset {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface PersistedFollowupDocument {
  localUri: string;
  sha256: string;
  filename: string;
  mimeType?: string;
  size?: number;
  inputModality: FollowupDocumentInputModality;
  parseQuality: FollowupDocumentParseQuality;
}

export interface LocalDocumentTextExtraction {
  text: string;
  summaryDraft: string;
  method: "docx_text" | "pdf_text_best_effort" | "image_manual_required" | "manual";
  parseQuality: FollowupDocumentParseQuality;
  error: string | null;
}

const LOCAL_DOCUMENT_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}caremind-followup-documents/`;

export function inferFollowupDocumentModality(
  name: string,
  mimeType?: string | null
): FollowupDocumentInputModality {
  const normalizedName = name.toLowerCase();
  const normalizedMime = (mimeType ?? "").toLowerCase();

  if (normalizedMime.includes("image/") || /\.(jpe?g|png)$/.test(normalizedName)) {
    return "image";
  }
  if (normalizedMime.includes("pdf") || normalizedName.endsWith(".pdf")) {
    return "pdf";
  }
  if (
    normalizedMime.includes("wordprocessingml.document") ||
    normalizedName.endsWith(".docx")
  ) {
    return "docx";
  }
  return "manual";
}

export function localDocumentCapabilityLabel(modality: FollowupDocumentInputModality): string {
  if (modality === "image") return "本机图片/截图已保存，当前以手动摘要进入复诊材料";
  if (modality === "pdf") return "本机 PDF 已保存，当前以手动摘要进入复诊材料";
  if (modality === "docx") return "本机 DOCX 已保存，当前以手动摘要进入复诊材料";
  return "手动摘要";
}

export async function persistFollowupDocumentAsset(
  asset: PickedFollowupAsset,
  options: { hasManualSummary: boolean }
): Promise<PersistedFollowupDocument> {
  if (!LOCAL_DOCUMENT_DIR) {
    throw new Error("本机资料目录不可用，请稍后重试。");
  }

  await ensureDocumentDirectory();
  const filename = sanitizeFilename(asset.name || `followup_${Date.now()}`);
  const destination = `${LOCAL_DOCUMENT_DIR}${Date.now()}_${filename}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destination });

  const info = await FileSystem.getInfoAsync(destination);
  const sha256 = await sha256File(destination);
  const modality = inferFollowupDocumentModality(filename, asset.mimeType);

  return {
    localUri: destination,
    sha256,
    filename,
    mimeType: asset.mimeType ?? undefined,
    size: asset.size ?? (info.exists ? info.size : undefined),
    inputModality: modality,
    parseQuality: options.hasManualSummary ? "partially_readable" : "unsupported"
  };
}

export async function extractLocalFollowupDocumentText(
  input: {
    localUri: string;
    filename: string;
    mimeType?: string;
    modality: FollowupDocumentInputModality;
  }
): Promise<LocalDocumentTextExtraction> {
  if (input.modality === "docx") {
    return extractDocxText(input.localUri);
  }
  if (input.modality === "pdf") {
    return extractPdfTextBestEffort(input.localUri);
  }
  if (input.modality === "image") {
    return {
      text: "",
      summaryDraft: "",
      method: "image_manual_required",
      parseQuality: "unsupported",
      error: "图片/截图已保存在本机；当前 build 没有启用本地 OCR 或 Gemma 图像 encoder，请手动补充摘要。"
    };
  }
  return {
    text: "",
    summaryDraft: "",
    method: "manual",
    parseQuality: "unsupported",
    error: null
  };
}

export function buildLocalDocumentParseResult({
  documentId,
  typeLabel,
  filename,
  mimeType,
  size,
  sha256,
  manualSummary,
  extractedText,
  extractionMethod,
  modality,
  parseQuality
}: {
  documentId: string;
  typeLabel: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  manualSummary: string;
  extractedText?: string;
  extractionMethod?: LocalDocumentTextExtraction["method"];
  modality: FollowupDocumentInputModality;
  parseQuality: FollowupDocumentParseQuality;
}): FollowupDocumentParseResult {
  const summary = manualSummary.trim();
  const localText = (extractedText ?? "").trim();
  const usableText = summary || localText;
  const hasUsableText = usableText.length > 0;
  const filenameDate = inferDateFromFilename(filename ?? "");
  const terms = extractMedicalTermCandidates(usableText);
  const communicationPoints = buildCommunicationPoints({
    typeLabel,
    modality,
    summary: usableText,
    terms
  });
  const provenance = buildLocalDocumentProvenance({
    source: summary ? "manual_draft" : hasUsableText ? "rule_local_fallback" : "unavailable",
    reason: summary ? null : hasUsableText ? "local_text_extraction_without_family_confirmation" : "manual_summary_required",
    parseSucceeded: hasUsableText
  });

  const extractedFields = [
    {
      field: "document_type",
      label: "资料类型",
      value: typeLabel,
      confidence: "high" as const,
      source: "document_type" as const,
      requires_confirmation: false
    },
    {
      field: "input_modality",
      label: "输入形式",
      value: modalityLabel(modality),
      confidence: "high" as const,
      source: "file_quality" as const,
      requires_confirmation: false
    },
    {
      field: "parse_quality",
      label: "本地整理状态",
      value: parseQualityLabel(parseQuality),
      confidence: "high" as const,
      source: "file_quality" as const,
      requires_confirmation: false
    },
    filename
      ? {
          field: "filename",
          label: "文件名",
          value: filename,
          confidence: "high" as const,
          source: "filename" as const,
          requires_confirmation: false
        }
      : null,
    filenameDate
      ? {
          field: "date",
          label: "日期候选",
          value: filenameDate,
          confidence: "medium" as const,
          source: "filename" as const,
          requires_confirmation: true
        }
      : null,
    mimeType
      ? {
          field: "mime_type",
          label: "文件类型",
          value: mimeType,
          confidence: "high" as const,
          source: "file_quality" as const,
          requires_confirmation: false
        }
      : null,
    typeof size === "number"
      ? {
          field: "file_size",
          label: "文件大小",
          value: formatLocalFileSize(size),
          confidence: "high" as const,
          source: "file_quality" as const,
          requires_confirmation: false
        }
      : null,
    sha256
      ? {
          field: "sha256",
          label: "SHA-256",
          value: `${sha256.slice(0, 12)}...${sha256.slice(-8)}`,
          confidence: "high" as const,
          source: "file_quality" as const,
          requires_confirmation: false
        }
      : null,
    extractionMethod
      ? {
          field: "local_extraction",
          label: "本地处理方式",
          value: extractionMethodLabel(extractionMethod),
          confidence: "high" as const,
          source: "file_quality" as const,
          requires_confirmation: false
        }
      : null,
    hasUsableText
      ? {
          field: summary ? "manual_summary" : "local_text_excerpt",
          label: summary ? "家属摘要" : "本地文本摘录",
          value: usableText.slice(0, 360),
          confidence: summary ? ("medium" as const) : ("low" as const),
          source: summary ? ("user_summary" as const) : ("file_quality" as const),
          requires_confirmation: true
        }
      : null
  ].filter((field): field is NonNullable<typeof field> => field !== null);

  return {
    document_id: documentId,
    status: "review_required",
    extracted_fields: extractedFields,
    review_questions: hasUsableText
      ? [
          {
            id: "confirm_document_points",
            question: "请确认这些资料要点是否适合作为复诊沟通材料。",
            reason: "本地资料整理只做沟通准备，仍需要家属确认。"
          }
        ]
      : [
          {
            id: "manual_summary_required",
            question: "请补充这份资料最重要的 1-3 个信息点。",
            reason: "文件已保存在本机；当前离线路径无法可靠读取内容。"
          }
        ],
    followup_summary_items: hasUsableText
      ? [`${typeLabel}：${usableText.slice(0, 180)}`, ...communicationPoints]
      : [`${typeLabel}：文件已保存在本机，待家属补充摘要。`],
    medical_boundary: "本地资料整理只用于复诊沟通准备，不判断诊断、检查必要性或用药调整。",
    parse_quality: parseQuality,
    doctor_review_needed: true,
    medical_term_candidates: terms,
    safety_flags: [
      "track_c_offline",
      "cloud_upload_blocked",
      modality === "image" ? "image_saved_locally" : "document_saved_locally",
      ...(summary ? ["manual_summary_confirmed"] : []),
      ...(localText ? ["local_text_extracted"] : []),
      ...(modality === "image" ? ["native_vision_not_available"] : []),
      ...(hasUsableText ? [] : ["manual_summary_required"])
    ],
    model_profile: "local_metadata_document_parser",
    multimodal_attempted: false,
    requires_family_confirmation: true,
    parsed_at: new Date().toISOString(),
    parse_error: hasUsableText ? null : "manual_summary_required",
    inference_provenance: provenance
  };
}

export function buildLocalDocumentProvenance({
  source,
  reason,
  parseSucceeded
}: {
  source: "manual_draft" | "rule_local_fallback" | "unavailable";
  reason: string | null;
  parseSucceeded: boolean;
}) {
  return {
    source,
    task: "followup_document" as const,
    modelId: "local_document_parser",
    backend: "on_device_storage",
    latencyMs: 0,
    engineInitialized: false,
    nativeGenerateAttempted: false,
    nativeGenerateReturned: false,
    rawOutputLength: 0,
    rawOutputHash: null,
    parseSucceeded,
    fallbackReason: reason
  };
}

export async function deletePersistedFollowupDocument(localUri?: string): Promise<void> {
  if (!localUri) return;
  try {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
  } catch {
    // Deleting local cached clinical material should not block UI deletion.
  }
}

function modalityLabel(modality?: FollowupDocumentInputModality): string {
  if (modality === "image") return "图片/截图";
  if (modality === "pdf") return "PDF";
  if (modality === "docx") return "DOCX";
  return "手动摘要";
}

function parseQualityLabel(quality?: FollowupDocumentParseQuality): string {
  if (quality === "readable") return "可读";
  if (quality === "partially_readable") return "部分可读";
  if (quality === "unreadable") return "无法可靠读取";
  if (quality === "unsupported") return "待手动摘要";
  return "未整理";
}

function extractionMethodLabel(method: LocalDocumentTextExtraction["method"]): string {
  if (method === "docx_text") return "DOCX 本地文本抽取";
  if (method === "pdf_text_best_effort") return "PDF 本地轻量文本抽取";
  if (method === "image_manual_required") return "图片本地保存，待手动摘要";
  return "手动摘要";
}

function formatLocalFileSize(size?: number): string {
  if (!size) return "大小未知";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function extractDocxText(uri: string): Promise<LocalDocumentTextExtraction> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) {
      return textExtractionFailure("docx_text", "DOCX 中没有找到 word/document.xml。");
    }
    const text = xmlTextToPlainText(documentXml);
    if (!text) {
      return textExtractionFailure("docx_text", "DOCX 未抽取到可读文本。");
    }
    return {
      text,
      summaryDraft: summarizeExtractedText(text),
      method: "docx_text",
      parseQuality: text.length > 80 ? "readable" : "partially_readable",
      error: null
    };
  } catch (error) {
    return textExtractionFailure("docx_text", error instanceof Error ? error.message : "DOCX 本地抽取失败。");
  }
}

async function extractPdfTextBestEffort(uri: string): Promise<LocalDocumentTextExtraction> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    });
    const raw = bytesToBinaryString(base64ToBytes(base64));
    const literalMatches = [...raw.matchAll(/\(([^()\r\n]{2,140})\)/g)]
      .map((match) => match[1])
      .map((text) => text.replace(/\\([()\\])/g, "$1").trim())
      .filter((text) => /[\w\u4e00-\u9fa5]/.test(text));
    const text = Array.from(new Set(literalMatches)).join(" ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 12) {
      return textExtractionFailure("pdf_text_best_effort", "PDF 可能是扫描件或压缩文本，轻量本地抽取未读到可靠文本。");
    }
    return {
      text,
      summaryDraft: summarizeExtractedText(text),
      method: "pdf_text_best_effort",
      parseQuality: text.length > 80 ? "partially_readable" : "unreadable",
      error: null
    };
  } catch (error) {
    return textExtractionFailure("pdf_text_best_effort", error instanceof Error ? error.message : "PDF 本地抽取失败。");
  }
}

function textExtractionFailure(
  method: LocalDocumentTextExtraction["method"],
  error: string
): LocalDocumentTextExtraction {
  return {
    text: "",
    summaryDraft: "",
    method,
    parseQuality: "unsupported",
    error
  };
}

function xmlTextToPlainText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizeExtractedText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
}

function inferDateFromFilename(filename: string): string | null {
  const normalized = filename.replace(/[._]/g, "-");
  const ymd = normalized.match(/(20\d{2})[-年]?(0?[1-9]|1[0-2])[-月]?(0?[1-9]|[12]\d|3[01])/);
  if (!ymd) return null;
  const [, year, month, day] = ymd;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractMedicalTermCandidates(text: string): FollowupDocumentParseResult["medical_term_candidates"] {
  if (!text.trim()) return [];
  const candidates = [
    "MMSE",
    "MoCA",
    "MRI",
    "CT",
    "hippocampal",
    "atrophy",
    "海马",
    "萎缩",
    "脑白质",
    "剂量",
    "用药",
    "量表"
  ].filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  return Array.from(new Set(candidates)).slice(0, 5).map((term) => ({
    term,
    original_text: term,
    family_explanation: "保留原文，具体含义和处理请复诊时由医生结合病史解释。",
    confidence: "medium",
    requires_confirmation: true
  }));
}

function buildCommunicationPoints(input: {
  typeLabel: string;
  modality: FollowupDocumentInputModality;
  summary: string;
  terms: FollowupDocumentParseResult["medical_term_candidates"];
}): string[] {
  const points: string[] = [];
  if (input.summary) {
    points.push(`复诊时请医生结合近期照护记录确认：${input.summary.slice(0, 90)}`);
  }
  if (input.typeLabel.includes("用药") || /药|剂量|服药|拒药/.test(input.summary)) {
    points.push("请医生确认当前用药记录、拒药/漏药情况和家属应如何观察。");
  }
  if (input.typeLabel.includes("MRI") || input.typeLabel.includes("CT") || input.modality === "image") {
    points.push("请医生解释资料中的术语和结果，CareMind 不做诊断判断。");
  }
  if (input.terms.length > 0) {
    points.push(`可向医生确认术语：${input.terms.map((term) => term.term).join("、")}。`);
  }
  return Array.from(new Set(points)).slice(0, 3);
}

async function ensureDocumentDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(LOCAL_DOCUMENT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(LOCAL_DOCUMENT_DIR, { intermediates: true });
  }
}

function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || `followup_${Date.now()}`;
}

async function sha256File(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  return sha256Bytes(base64ToBytes(base64));
}

function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outputLength = Math.floor((clean.length * 3) / 4) - padding;
  const output = new Uint8Array(Math.max(0, outputLength));
  let outputIndex = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const a = decodeBase64Char(clean.charCodeAt(index));
    const b = decodeBase64Char(clean.charCodeAt(index + 1));
    const c = clean[index + 2] === "=" ? 0 : decodeBase64Char(clean.charCodeAt(index + 2));
    const d = clean[index + 3] === "=" ? 0 : decodeBase64Char(clean.charCodeAt(index + 3));
    const triple = (a << 18) | (b << 12) | (c << 6) | d;

    if (outputIndex < output.length) output[outputIndex++] = (triple >> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (triple >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = triple & 0xff;
  }

  return output;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return output;
}

function decodeBase64Char(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return 0;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Bytes(input: Uint8Array): string {
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high);
  view.setUint32(paddedLength - 4, low);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(toHex32).join("");
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

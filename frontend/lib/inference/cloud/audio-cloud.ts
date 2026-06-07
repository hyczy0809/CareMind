import { buildApiUrl, readableApiError } from "../shared/http";
import type { AudioTranscriptionResponse, TranscribeAudioNoteInput } from "../shared/types";

export async function transcribeAudioNoteCloud(
  input: TranscribeAudioNoteInput
): Promise<AudioTranscriptionResponse> {
  const formData = new FormData();
  formData.append("patient_id", input.patientId);
  formData.append("language", input.language ?? "zh");
  formData.append("file", {
    uri: input.asset.uri,
    name: input.asset.name,
    type: input.asset.mimeType ?? "audio/m4a"
  } as unknown as Blob);

  const response = await fetch(buildApiUrl("/api/audio/transcribe"), {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readableApiError(response, "语音转文字失败"));
  }

  return (await response.json()) as AudioTranscriptionResponse;
}

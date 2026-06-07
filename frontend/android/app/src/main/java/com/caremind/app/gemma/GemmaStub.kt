package com.caremind.app.gemma

import java.io.File

/**
 * Dev-only stub. When stub mode is enabled, the React Native module bypasses
 * MediaPipe entirely and returns canned responses keyed by prompt fingerprint.
 * Lets us verify the JS↔native wiring before real Gemma weights are hosted.
 *
 * Stub responses cover all four routed tasks. They are intentionally minimal
 * but schema-valid so the V2 mappers downstream do not fall back further.
 */
object GemmaStub {

    fun writeSentinel(target: File) {
        target.parentFile?.mkdirs()
        if (target.exists()) target.delete()
        target.outputStream().use { it.write(byteArrayOf(0x42)) }
    }

    fun respond(prompt: String): String {
        val p = prompt
        return when {
            "复诊沟通要点" in p || "followup" in p.lowercase() -> followupJson()
            "判断家属笔记是否触及以下边界" in p -> guardrailJson()
            "结构化照护记录" in p -> careWorkflowJson()
            "逐字转写" in p -> transcriptionStub()
            else -> "{}"
        }
    }

    private fun careWorkflowJson(): String = """
    {
      "structured_log": {
        "sleep": { "night_wakings": 2, "note": "记录到夜间起床 2 次（桩示例）" },
        "behavior": [],
        "nutrition": {
          "meal_intake": "few_bites",
          "water_intake": "unknown",
          "choking": "unknown",
          "weight_change": "unknown",
          "note": "桩示例：晚饭只吃了几口"
        },
        "medication": {
          "mentioned": false,
          "refusal_count": null,
          "missed_dose": "unknown",
          "duplicate_dose": "unknown",
          "medication_names": [],
          "note": "未提到服药变化（桩）"
        },
        "safety": {
          "night_wandering": true,
          "door_exit_attempt": "unknown",
          "fall": "unknown",
          "wandering": "unknown",
          "acute_danger": false,
          "note": "桩示例：建议关注夜间安全"
        },
        "caregiver": { "quote": "（桩）需要更多休息", "stress_level": "medium" }
      },
      "attention_items": [
        {
          "type": "night_safety",
          "severity": "medium",
          "title": "今晚留意夜间起床安全（本地桩）",
          "evidence": "桩示例：夜间起床 2 次",
          "doctor_feedback_hint": "持续出现可在复诊时告知医生。",
          "actions": [
            { "label": "打开走廊夜灯", "alternative_label": "如不能开灯，先清理床边到卫生间这条路。" },
            { "label": "睡前确认门锁", "alternative_label": "睡前把钥匙放到家属能管理的位置。" }
          ]
        }
      ],
      "memory_candidates": [],
      "communication_script": null,
      "guardrail": { "triggered": false, "type": "none", "message": null }
    }
    """.trimIndent()

    private fun guardrailJson(): String = """
    {
      "triggered": false,
      "type": "none",
      "message": null,
      "alternative_cta": null
    }
    """.trimIndent()

    private fun followupJson(): String = """
    {
      "metrics": [
        { "label": "记录数", "value": "3", "helper": "近期（桩）", "tone": "brand" },
        { "label": "夜间安全", "value": "1", "helper": "关注事项", "tone": "alert" }
      ],
      "followup_patch": {
        "summary_bullets": [
          "（桩示例）近期已保存 3 条照护记录。",
          "出现夜间起床或安全相关线索。"
        ],
        "doctor_questions": [
          "夜间起床和外出冲动是否需要进一步评估？",
          "近期食欲下降是否需要营养支持建议？"
        ],
        "materials_to_bring": []
      },
      "tried_strategies": [],
      "boundary_notice": "以上仅用于复诊沟通整理（桩示例），诊断与用药请以医生判断为准。"
    }
    """.trimIndent()

    private fun transcriptionStub(): String =
        "（本地桩转写示例）今天早上奶奶起床后状态稳定，吃了半碗稀饭。"
}

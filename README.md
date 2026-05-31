# CareMind

CareMind is an ADK-based multi-agent care assistant for families caring for
people with dementia. It turns daily natural-language care notes into structured
care logs, non-diagnostic risk cards, caregiver support suggestions, daily care
plans, communication scripts, and follow-up summaries.

The current implementation focuses on the cloud-side agent group. It exposes an
OpenAI-compatible HTTP API through FastAPI and runs Google ADK agents against a
Cloudflare AI Gateway OpenAI-compatible model endpoint.

## Architecture

CareMind is designed as an edge-cloud care system:

- Edge side: short-term companionship, low-latency response, offline-friendly
  recording, privacy-first white-box indicators, and immediate reminders.
- Cloud side: long-term tracking, professional summaries, multi-day trend
  analysis, caregiver burden support, and follow-up materials.

The cloud side is implemented as an A2A multi-agent system:

```text
caremind_cloud_root_agent
├── event_structuring_agent
├── patient_risk_agent
├── caregiver_support_agent
├── care_plan_agent
└── doctor_summary_agent
```

For demos, the root agent also exposes a one-shot workflow tool:

```python
run_cloud_care_workflow(...)
```

It runs the full cloud care loop:

```text
care note
-> event extraction
-> patient risk card
-> caregiver support card
-> daily care plan
-> doctor follow-up summary
```

## Features

- FastAPI service with CORS enabled.
- OpenAI-compatible `POST /v1/chat/completions` endpoint.
- Google ADK root agent with cloud-side sub-agents.
- White-box care indicators for night safety, wandering, medication refusal,
  behavioral symptoms, sleep disruption, and caregiver distress.
- JSON-backed demo care memory for events, risk cards, plans, reminders, and
  caregiver support cards.
- Dementia-friendly communication scripts for common care conflicts.
- Non-diagnostic safety boundaries for all care suggestions.
- Cloudflare AI Gateway OpenAI-compatible model adapter with function calling.

## Project Layout

```text
.
├── main.py
├── openai_compat.py
├── requirements.txt
├── Dockerfile
├── .env.example
├── md/
│   └── 大纲.md
└── my_agent/
    ├── agent.py
    ├── cloud_agents.py            # Agent definitions (Memory-augmented)
    ├── cloud_tools.py             # Core tool functions + Memory workflow
    ├── care_state.py
    ├── model_config.py
    ├── cloudflare_openai_model.py
    ├── memory_schema.py           # Memory data structures & built-in knowledge
    ├── memory_state.py            # JSON read/write for memory_store/
    ├── memory_tools.py            # retrieve_* / update_* tool functions
    ├── memory_router.py           # Event-based Memory request routing
    ├── memory_policy.py           # Write-gate policy (auto / confirm / block)
    └── memory_store/
        ├── patient_profile.json
        ├── medication_memory.json
        ├── behavior_baseline.json
        ├── episodic_events.json
        └── caregiver_state.json
```

## Quick Start

Install dependencies:

```bash
pip install -r requirements.txt
```

> **Python version requirement:** Python 3.10 or later is required (the codebase
> uses `int | None` union type syntax introduced in Python 3.10).

Create a local environment file:

```bash
cp .env.example .env
```

Set the required values in `.env`:

```env
CF_AIG_TOKEN=your-cloudflare-ai-gateway-token
CF_AIG_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat
MODEL_NAME=google-ai-studio/gemini-2.5-flash
PROMPT_MODE=WEAK
PORT=8080
```

Start the ADK Web UI (recommended for interactive testing):

```bash
adk web --port 8080 my_agent
```

Or start the FastAPI service directly:

```bash
python main.py
```

The API runs on `http://localhost:8080` by default.

## API Example

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my_agent",
    "messages": [
      {
        "role": "user",
        "content": "妈妈今天下午一直说要回老家，晚上不肯吃药，半夜起来三次，还想开门出去。我昨天几乎没睡，整个人很烦躁。"
      }
    ],
    "stream": false
  }'
```

---

## Memory Module

CareMind now includes a persistent Memory layer that upgrades it from a
single-turn care assistant to a long-term family care agent. The Memory module
is designed around the principle that dementia care is inherently longitudinal:
patterns, interventions, and caregiver states must be tracked across sessions to
provide meaningful, personalised support.

### Design Goals

1. **Personalisation** — remember the patient's communication preferences,
   behavioural patterns, medication schedule, and effective calming strategies.
2. **Long-term tracking** — accumulate daily care events to detect trends in
   night wandering, medication refusal, behavioural escalation, and caregiver
   fatigue.
3. **Professional knowledge retrieval** — surface dementia care guidelines,
   safety rules, and communication principles at the right moment without
   crossing diagnostic boundaries.

### Memory Types

| Memory Type | Storage | Contents | Privacy |
|---|---|---|---|
| Patient Profile | Local (`patient_profile.json`) | Age, diagnosis stage, comorbidities, communication preferences, daily routine | Default local |
| Medication Memory | Local (`medication_memory.json`) | Current medications, dosage, schedule, refusal/missed-dose log | Default local |
| Behavior Baseline | Local (`behavior_baseline.json`) | Known behaviours, triggers, effective/ineffective interventions | Default local |
| Episodic Events | Local (`episodic_events.json`) | Structured daily care events with timestamps and severity | Desensitised summaries may sync to cloud |
| Caregiver State | Local (`caregiver_state.json`) | Sleep quality, stress signals, burnout indicators | Default local |
| Professional Knowledge | Built-in (`memory_schema.py`) | Dementia care guidelines, safety boundaries, communication scripts | Cloud-maintained |

### Memory-Augmented Workflow (`run_cloud_care_workflow`)

The one-shot workflow now runs **11 steps** instead of the original 5:

```text
Step 1   Event extraction          extract_care_signals / log_extracted_events
Step 2   Auto-write Episodic Memory update_event_memory
Step 3   Memory Router             route_memory_requests  (decide what to retrieve)
Step 4   Memory retrieval          patient_profile / behavior_baseline /
                                   medication_memory / recent_events /
                                   caregiver_state / professional_knowledge
Step 5   Patient risk assessment   assess_patient_risk  (+memory_context_summary)
Step 6   Caregiver burden check    assess_caregiver_burden
Step 7   Care plan generation      create_care_plan  (+memory_enriched_hints)
Step 8   Update caregiver state    update_caregiver_state
Step 9   Long-term Memory proposal propose_memory_update → classify_memory_candidates
Step 10  User confirmation prompt  build_confirmation_prompt  (for confirm-required items)
Step 11  Doctor follow-up summary  generate_doctor_summary
```

### Memory-Augmented Agent Tools

Each cloud agent now receives the appropriate Memory tools:

| Agent | Memory tools added |
|---|---|
| `event_structuring_agent` | `update_event_memory`, `retrieve_patient_profile` |
| `patient_risk_agent` | `retrieve_patient_profile`, `retrieve_recent_events`, `retrieve_behavior_baseline`, `retrieve_professional_knowledge`, `retrieve_safety_rules` |
| `caregiver_support_agent` | `retrieve_caregiver_state`, `update_caregiver_state`, `retrieve_professional_knowledge` |
| `care_plan_agent` | `retrieve_patient_profile`, `retrieve_behavior_baseline`, `retrieve_similar_care_cases`, `retrieve_medication_memory`, `retrieve_professional_knowledge`, `propose_memory_update`, `confirm_and_update_behavior_baseline` |
| `doctor_summary_agent` | `retrieve_recent_events`, `retrieve_medication_memory`, `retrieve_behavior_baseline`, `retrieve_caregiver_state`, `retrieve_patient_profile` |

### Memory Write-Gate Policy

To prevent hallucinated or low-confidence data from polluting long-term memory,
all writes pass through `memory_policy.py`:

- **Auto-write** — episodic events and caregiver state updates are written
  immediately without user confirmation.
- **Needs confirmation** — behaviour baseline updates and patient profile changes
  require a user-facing confirmation prompt.
- **Blocked** — any candidate flagged as a diagnostic conclusion or medication
  recommendation is rejected.

### New Module Files

```text
my_agent/
├── memory_schema.py   — Dataclass definitions for all Memory types + 7 built-in
│                        professional knowledge entries + Safety Memory rules
├── memory_state.py    — Thread-safe JSON read/write helpers for memory_store/
├── memory_tools.py    — ADK-compatible tool functions (retrieve_* / update_*)
├── memory_router.py   — Routes Memory retrieval requests based on event types
└── memory_policy.py   — Write-gate: auto / needs_confirmation / blocked
```

---

## Notes

- Do not commit `.env`; use `.env.example` as the template.
- `my_agent/care_state.json` is runtime state and is ignored by git.
- `my_agent/memory_store/` holds persistent Memory JSON files. Back these up if
  you want to preserve long-term care history across environments.
- If Cloudflare should forward a separate provider API key, set `MODEL_API_KEY`.
- Otherwise, `CF_AIG_TOKEN` is used as the gateway credential.
- CareMind provides care support and communication preparation. It does not
  diagnose, prescribe, or replace medical professionals.

## License

MIT

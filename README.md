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
    ├── cloud_agents.py
    ├── cloud_tools.py
    ├── care_state.py
    ├── model_config.py
    └── cloudflare_openai_model.py
```

## Quick Start

Install dependencies:

```bash
pip install -r requirements.txt
```

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

Start the service:

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

## Notes

- Do not commit `.env`; use `.env.example` as the template.
- `my_agent/care_state.json` is runtime state and is ignored by git.
- If Cloudflare should forward a separate provider API key, set
  `MODEL_API_KEY`.
- Otherwise, `CF_AIG_TOKEN` is used as the gateway credential.
- CareMind provides care support and communication preparation. It does not
  diagnose, prescribe, or replace medical professionals.

## License

MIT

# CareMind

CareMind is a small ADK-based agent service with an OpenAI-compatible HTTP API.
It runs a Chinese assistant through Google ADK and calls an OpenAI-compatible
model endpoint through Cloudflare AI Gateway.

## Features

- FastAPI service with CORS enabled.
- OpenAI-compatible `POST /v1/chat/completions` endpoint.
- ADK session support for multi-turn conversations.
- Local tools for China Standard Time and SSE Composite Index lookup.
- Cloudflare AI Gateway model adapter with function-calling support.
- Dockerfile for simple container deployment.

## Project Layout

```text
.
├── main.py
├── openai_compat.py
├── requirements.txt
├── Dockerfile
├── .env.example
└── my_agent/
    ├── agent.py
    ├── cloudflare_openai_model.py
    └── tools.py
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
      {"role": "user", "content": "现在北京时间几点？"}
    ],
    "stream": false
  }'
```

## Notes

- Do not commit `.env`; use `.env.example` as the template.
- If Cloudflare should forward a separate provider API key, set `MODEL_API_KEY`.
- Otherwise, `CF_AIG_TOKEN` is used as the gateway credential.

## License

MIT

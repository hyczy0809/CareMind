FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN adduser --disabled-password --gecos "" myuser

COPY . .

RUN chown -R myuser:myuser /app

USER myuser

ENV PATH="/home/myuser/.local/bin:$PATH"
# Default model directory inside the container. Override with a volume mount
# in docker-compose.yml or Cloud Run --set-env-vars when using stream mode.
ENV CAREMIND_GEMMA_MODEL_DIR=/models

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]

# ASR service. Build one image per provider so the image stays as small as the choice allows:
#   docker build --build-arg PROVIDER=whisper -t vetflow-asr .     (faster-whisper, MIT, small)
#   docker build --build-arg PROVIDER=canary  -t vetflow-asr .     (NeMo + PyTorch CPU, large)
FROM python:3.11-slim AS base
ARG PROVIDER=whisper
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models
WORKDIR /srv
COPY requirements-base.txt .
RUN pip install -r requirements-base.txt
COPY requirements-${PROVIDER}.txt .
RUN pip install -r requirements-${PROVIDER}.txt
COPY app.py .
RUN useradd -r -u 10001 asr && mkdir -p /models && chown asr /models
USER asr
ENV ASR_PROVIDER=${PROVIDER}
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY packages.txt requirements.txt ./
RUN apt-get update \
    && tr -d '\r' < packages.txt | xargs apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt

COPY IJV.py ofp_render.py render_api.py *.png ./
COPY static/ ./static/
COPY deploy/ ./deploy/
RUN python deploy/install_metadata.py \
    && useradd --create-home --uid 10001 streamlit
USER streamlit
EXPOSE 8501
CMD ["streamlit", "run", "IJV.py", "--server.address=0.0.0.0", "--server.port=8501", "--server.headless=true", "--server.enableStaticServing=true", "--browser.gatherUsageStats=false"]

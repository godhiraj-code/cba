FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-venv \
    && python3 -m venv /opt/starlight-venv \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/starlight-venv/bin:${PATH}"
ENV NODE_ENV=production
ENV STARLIGHT_HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY sdk/ ./sdk/
COPY sentinels/ ./sentinels/
COPY schemas/ ./schemas/
COPY config.json ./

RUN mkdir -p /app/screenshots \
    && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/hub.js"]

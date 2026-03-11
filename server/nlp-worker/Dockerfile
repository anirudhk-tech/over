FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Download spaCy model at build time so workers start instantly
RUN python -m spacy download en_core_web_sm
COPY nlp-worker/ .
CMD ["python", "-m", "main"]

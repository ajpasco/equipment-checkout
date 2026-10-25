# The API's image (blueprint 12.4, 13.1): the application run as `uvicorn app.main:app` by a
# non-root user. No setting is baked in: DATABASE_URL comes from Compose when the container starts.
FROM python:3.12.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/api

# The lockfile first, so a change to the code does not reinstall the dependencies.
COPY requirements.txt ./
RUN pip install -r requirements.txt

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin api
COPY app ./app

USER api
EXPOSE 8000
# uvicorn's own access log is off, so the `app.access` line is the only request log (5.4).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

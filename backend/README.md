# Jellyroll Designer API

FastAPI backend for the Jellyroll Battery Cell Designer.

## Quick Start (Docker)

```bash
cp .env.example .env
docker-compose up --build
```

API available at `http://localhost:8000`
Docs at `http://localhost:8000/docs`

## Quick Start (Local)

```bash
# Start PostgreSQL (Docker)
docker-compose up -d db

# Install dependencies
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --reload --port 8000
```

## Configuration

Set environment variables (or edit `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `JR_DATABASE_URL` | `postgresql+asyncpg://jellyroll:jellyroll@localhost:5432/jellyroll` | Database connection |
| `JR_API_KEY` | `dev-key-change-me` | API authentication key |
| `JR_CORS_ORIGINS` | `["http://localhost:8000"]` | Allowed CORS origins |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/designs` | List designs |
| POST | `/api/v1/designs` | Create design |
| GET | `/api/v1/designs/{id}` | Get design with results |
| PUT | `/api/v1/designs/{id}` | Update design |
| DELETE | `/api/v1/designs/{id}` | Delete design |
| POST | `/api/v1/designs/import` | Import from JSON |
| GET | `/api/v1/designs/{id}/export` | Export as JSON |
| POST | `/api/v1/designs/{id}/simulation` | Save simulation result |
| POST | `/api/v1/designs/{id}/capacity` | Save capacity result |

All endpoints require `Authorization: Bearer <API_KEY>` header.

from fastapi import FastAPI

from app.config import Settings

settings = Settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Проверяет доступность API без обращения к внешним сервисам."""
    return {"status": "ok"}

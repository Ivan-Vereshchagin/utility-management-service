import logging
from urllib.parse import quote, quote_plus

from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth import router as auth_router
from app.config import Settings
from app.database import get_engine
from app.invitations import router as invitations_router
from app.properties import router as properties_router

settings = Settings()
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)
app.include_router(auth_router)
app.include_router(properties_router)
app.include_router(invitations_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Проверяет доступность API без обращения к внешним сервисам."""
    return {"status": "ok"}


@app.get("/health/db", tags=["health"])
def database_health() -> dict[str, str]:
    """Проверяет соединение с базой данных."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        original_error = getattr(exc, "orig", None)
        sqlstate = getattr(original_error, "sqlstate", None)
        reason = str(original_error or exc)
        password = engine.url.password
        if password:
            for secret in {password, quote(password), quote_plus(password)}:
                reason = reason.replace(secret, "[скрыто]")
        logger.warning(
            "Не удалось проверить БД: тип=%s, SQLSTATE=%s, причина=%s",
            type(original_error or exc).__name__,
            sqlstate or "отсутствует",
            reason,
        )
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

    return {"status": "ok"}

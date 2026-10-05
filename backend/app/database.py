from functools import lru_cache

from sqlalchemy import Engine, create_engine

from app.config import Settings


@lru_cache
def get_engine() -> Engine | None:
    database_url = Settings().database_url
    if database_url is None:
        return None

    return create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 3},
    )

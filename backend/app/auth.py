from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import get_engine
from app.models import User


router = APIRouter(prefix="/auth", tags=["auth"])
password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)
TOKEN_AUDIENCE = "utility-management-api"


class RegisterRequest(BaseModel):
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)


class RegisterResponse(BaseModel):
    id: int
    email: EmailStr
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> RegisterResponse:
    """Создаёт аккаунт и сохраняет только хеш пароля."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    user = User(
        email=str(payload.email).lower(),
        password_hash=password_hash.hash(payload.password),
    )
    with Session(engine) as session:
        session.add(user)
        try:
            session.commit()
            session.refresh(user)
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail="Email уже зарегистрирован") from exc
        except SQLAlchemyError as exc:
            session.rollback()
            raise HTTPException(status_code=503, detail="База данных недоступна") from exc

        return RegisterResponse(id=user.id, email=user.email, created_at=user.created_at)


def get_jwt_secret() -> str:
    secret = Settings().jwt_secret
    if secret is None or len(secret) < 32:
        raise HTTPException(status_code=503, detail="Ключ токенов не настроен")
    return secret


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Не удалось подтвердить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/login", response_model=AccessTokenResponse)
def login(payload: LoginRequest) -> AccessTokenResponse:
    """Проверяет пароль и выдаёт короткоживущий access-токен."""
    secret = get_jwt_secret()
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            user = session.scalar(
                select(User).where(User.email == str(payload.email).lower())
            )
            if user is None or not password_hash.verify(payload.password, user.password_hash):
                raise unauthorized()
            user_id = user.id
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

    now = datetime.now(timezone.utc)
    access_token = jwt.encode(
        {
            "sub": str(user_id),
            "type": "access",
            "aud": TOKEN_AUDIENCE,
            "iss": TOKEN_AUDIENCE,
            "iat": now,
            "exp": now + timedelta(minutes=15),
        },
        secret,
        algorithm="HS256",
    )
    return AccessTokenResponse(access_token=access_token)


@router.get("/me", response_model=RegisterResponse)
def get_me(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> RegisterResponse:
    """Возвращает пользователя по действующему access-токену."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()

    secret = get_jwt_secret()
    try:
        claims = jwt.decode(
            credentials.credentials,
            secret,
            algorithms=["HS256"],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_AUDIENCE,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
        if claims.get("type") != "access":
            raise unauthorized()
        user_id = int(claims["sub"])
        if user_id <= 0:
            raise unauthorized()
    except (InvalidTokenError, ValueError, TypeError) as exc:
        raise unauthorized() from exc

    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if user is None:
                raise unauthorized()
            return RegisterResponse(
                id=user.id, email=user.email, created_at=user.created_at
            )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

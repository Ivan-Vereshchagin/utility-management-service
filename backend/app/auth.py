from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import get_engine
from app.models import RefreshToken, User


router = APIRouter(prefix="/auth", tags=["auth"])
password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)
TOKEN_AUDIENCE = "utility-management-api"
REFRESH_COOKIE_NAME = "ums_refresh_token"
REFRESH_COOKIE_PATH = "/auth"
REFRESH_TOKEN_LIFETIME = timedelta(days=30)


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


def require_same_origin(request: Request) -> None:
    """Отклоняет запросы входа и обновления из сторонних браузерных страниц."""
    origin = request.headers.get("origin")
    if request.headers.get("sec-fetch-site") == "cross-site" or (
        origin is not None and origin != str(request.base_url).rstrip("/")
    ):
        raise HTTPException(status_code=403, detail="Источник запроса не разрешён")


def create_access_token(user_id: int, secret: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user_id),
            "type": "access",
            "aud": TOKEN_AUDIENCE,
            "iss": TOKEN_AUDIENCE,
            "iat": now,
            "exp": now + timedelta(minutes=15),
            "jti": uuid4().hex,
        },
        secret,
        algorithm="HS256",
    )


def create_refresh_token(
    session: Session, user_id: int, family_id: UUID, expires_at: datetime
) -> str:
    """Возвращает случайный токен, сохраняя в БД только его хеш."""
    token = token_urlsafe(32)
    session.add(
        RefreshToken(
            user_id=user_id,
            family_id=family_id,
            token_hash=sha256(token.encode()).hexdigest(),
            expires_at=expires_at,
        )
    )
    return token


def set_refresh_cookie(response: Response, token: str, expires_at: datetime) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        expires=expires_at.astimezone(timezone.utc),
        path=REFRESH_COOKIE_PATH,
        secure=Settings().refresh_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        secure=Settings().refresh_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


def invalid_refresh_response() -> JSONResponse:
    response = JSONResponse(
        status_code=401,
        content={"detail": "Refresh-токен недействителен. Войдите снова"},
        headers={"Cache-Control": "no-store"},
    )
    clear_refresh_cookie(response)
    return response


@router.post(
    "/login", response_model=AccessTokenResponse, dependencies=[Depends(require_same_origin)]
)
def login(payload: LoginRequest, response: Response) -> AccessTokenResponse:
    """Проверяет пароль и выдаёт access-токен и cookie с refresh-токеном."""
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
            expires_at = datetime.now(timezone.utc) + REFRESH_TOKEN_LIFETIME
            refresh_token = create_refresh_token(session, user_id, uuid4(), expires_at)
            access_token = create_access_token(user_id, secret)
            session.commit()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

    set_refresh_cookie(response, refresh_token, expires_at)
    return AccessTokenResponse(access_token=access_token)


@router.post(
    "/refresh", response_model=AccessTokenResponse, dependencies=[Depends(require_same_origin)]
)
def refresh(request: Request, response: Response) -> AccessTokenResponse | JSONResponse:
    """Обновляет оба токена; повторное использование старого отзывает цепочку."""
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        return invalid_refresh_response()

    secret = get_jwt_secret()
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    token_hash = sha256(token.encode()).hexdigest()
    try:
        with Session(engine) as session:
            user_id = session.scalar(
                select(RefreshToken.user_id).where(RefreshToken.token_hash == token_hash)
            )
            if user_id is None:
                return invalid_refresh_response()

            user = session.scalar(select(User).where(User.id == user_id).with_for_update())
            if user is None:
                return invalid_refresh_response()
            stored_token = session.scalar(
                select(RefreshToken).where(RefreshToken.token_hash == token_hash)
            )
            if stored_token is None:
                return invalid_refresh_response()

            now = datetime.now(timezone.utc)
            if stored_token.rotated_at is not None:
                session.execute(
                    update(RefreshToken)
                    .where(
                        RefreshToken.family_id == stored_token.family_id,
                        RefreshToken.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
                # Фиксируем отзыв до ответа с ошибкой, чтобы он не откатился.
                session.commit()
                return invalid_refresh_response()
            if stored_token.revoked_at is not None or stored_token.expires_at <= now:
                return invalid_refresh_response()

            stored_token.rotated_at = now
            # Вся цепочка истекает через 30 дней после входа, без продления при ротации.
            expires_at = stored_token.expires_at
            refresh_token = create_refresh_token(
                session, user_id, stored_token.family_id, expires_at
            )
            access_token = create_access_token(user_id, secret)
            session.commit()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

    set_refresh_cookie(response, refresh_token, expires_at)
    return AccessTokenResponse(access_token=access_token)


@router.post(
    "/logout", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_same_origin)],
)
def logout(request: Request, response: Response) -> None:
    """Отзывает цепочку текущего входа и удаляет refresh-cookie."""
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if token:
        engine = get_engine()
        if engine is None:
            raise HTTPException(status_code=503, detail="База данных не настроена")

        token_hash = sha256(token.encode()).hexdigest()
        try:
            with Session(engine) as session:
                stored_token = session.scalar(
                    select(RefreshToken).where(RefreshToken.token_hash == token_hash)
                )
                if stored_token is not None:
                    # Та же блокировка не даёт обновить токен одновременно с выходом.
                    user = session.scalar(
                        select(User)
                        .where(User.id == stored_token.user_id)
                        .with_for_update()
                    )
                    if user is not None:
                        session.execute(
                            update(RefreshToken)
                            .where(
                                RefreshToken.family_id == stored_token.family_id,
                                RefreshToken.revoked_at.is_(None),
                            )
                            .values(revoked_at=datetime.now(timezone.utc))
                        )
                        session.commit()
        except SQLAlchemyError as exc:
            raise HTTPException(status_code=503, detail="База данных недоступна") from exc

    clear_refresh_cookie(response)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> RegisterResponse:
    """Проверяет access-токен и возвращает текущего пользователя."""
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


@router.get("/me", response_model=RegisterResponse)
def get_me(current_user: RegisterResponse = Depends(get_current_user)) -> RegisterResponse:
    """Возвращает пользователя по действующему access-токену."""
    return current_user

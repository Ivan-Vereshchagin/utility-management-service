from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_engine
from app.models import User


router = APIRouter(prefix="/auth", tags=["auth"])
password_hash = PasswordHash.recommended()


class RegisterRequest(BaseModel):
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)


class RegisterResponse(BaseModel):
    id: int
    email: EmailStr
    created_at: datetime


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

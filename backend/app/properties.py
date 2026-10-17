from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Property


router = APIRouter(prefix="/properties", tags=["properties"])


class PropertyCreate(BaseModel):
    address: str = Field(min_length=1, max_length=500)
    name: str | None = Field(default=None, max_length=120)

    @field_validator("address", "name", mode="before")
    @classmethod
    def strip_whitespace(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("name")
    @classmethod
    def empty_name_is_missing(cls, value: str | None) -> str | None:
        return value or None


class PropertyResponse(BaseModel):
    id: int
    owner_id: int
    address: str
    name: str | None
    created_at: datetime


def to_response(item: Property) -> PropertyResponse:
    return PropertyResponse(
        id=item.id,
        owner_id=item.owner_id,
        address=item.address,
        name=item.name,
        created_at=item.created_at,
    )


@router.post("", response_model=PropertyResponse, status_code=status.HTTP_201_CREATED)
def create_property(
    payload: PropertyCreate, current_user: RegisterResponse = Depends(get_current_user)
) -> PropertyResponse:
    """Создаёт объект недвижимости для текущего пользователя."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            item = Property(
                owner_id=current_user.id,
                address=payload.address,
                name=payload.name,
            )
            session.add(item)
            session.commit()
            session.refresh(item)
            return to_response(item)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("", response_model=list[PropertyResponse])
def list_properties(
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[PropertyResponse]:
    """Возвращает только объекты, которыми владеет текущий пользователь."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            items = session.scalars(
                select(Property)
                .where(Property.owner_id == current_user.id)
                .order_by(Property.id)
            ).all()
            return [to_response(item) for item in items]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

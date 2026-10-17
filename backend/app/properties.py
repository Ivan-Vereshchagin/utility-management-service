from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Property, PropertyAccess, User


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


class PropertyUpdate(PropertyCreate):
    address: str | None = Field(default=None, min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_changes(self) -> "PropertyUpdate":
        if not self.model_fields_set:
            raise ValueError("Укажите хотя бы одно поле для изменения")
        if "address" in self.model_fields_set and self.address is None:
            raise ValueError("Адрес не может быть пустым")
        return self


class PropertyResponse(BaseModel):
    id: int
    owner_id: int
    address: str
    name: str | None
    created_at: datetime
    role: Literal["owner", "editor", "reader"]


class PropertyMemberResponse(BaseModel):
    user_id: int
    email: EmailStr
    role: Literal["editor", "reader"]
    joined_at: datetime


def to_response(item: Property, role: str) -> PropertyResponse:
    return PropertyResponse(
        id=item.id,
        owner_id=item.owner_id,
        address=item.address,
        name=item.name,
        created_at=item.created_at,
        role=role,
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
            return to_response(item, "owner")
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("/{property_id}", response_model=PropertyResponse)
def get_property(
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> PropertyResponse:
    """Возвращает объект владельцу или приглашённому участнику."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            row = session.execute(
                select(Property, PropertyAccess.role)
                .outerjoin(
                    PropertyAccess,
                    and_(
                        PropertyAccess.property_id == Property.id,
                        PropertyAccess.user_id == current_user.id,
                    ),
                )
                .where(
                    Property.id == property_id,
                    or_(
                        Property.owner_id == current_user.id,
                        PropertyAccess.user_id == current_user.id,
                    ),
                )
            ).one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="Объект не найден")
            item, member_role = row
            return to_response(
                item, "owner" if item.owner_id == current_user.id else member_role
            )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.patch("/{property_id}", response_model=PropertyResponse)
def update_property(
    payload: PropertyUpdate,
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> PropertyResponse:
    """Меняет адрес или название собственного объекта."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            item = session.scalar(
                select(Property)
                .where(
                    Property.id == property_id, Property.owner_id == current_user.id
                )
                .with_for_update()
            )
            if item is None:
                raise HTTPException(status_code=404, detail="Объект не найден")

            for field, value in payload.model_dump(exclude_unset=True).items():
                setattr(item, field, value)
            session.commit()
            session.refresh(item)
            return to_response(item, "owner")
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("/{property_id}/members", response_model=list[PropertyMemberResponse])
def list_property_members(
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[PropertyMemberResponse]:
    """Показывает владельцу пользователей с доступом к объекту."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            owned_property = session.scalar(
                select(Property.id).where(
                    Property.id == property_id, Property.owner_id == current_user.id
                )
            )
            if owned_property is None:
                raise HTTPException(status_code=404, detail="Объект не найден")

            rows = session.execute(
                select(PropertyAccess, User.email)
                .join(User, User.id == PropertyAccess.user_id)
                .where(PropertyAccess.property_id == property_id)
                .order_by(PropertyAccess.created_at, PropertyAccess.user_id)
            ).all()
            return [
                PropertyMemberResponse(
                    user_id=access.user_id,
                    email=email,
                    role=access.role,
                    joined_at=access.created_at,
                )
                for access, email in rows
            ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.delete("/{property_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_property_member(
    property_id: int = Path(gt=0),
    user_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> None:
    """Удаляет доступ участника по запросу владельца объекта."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            access = session.scalar(
                select(PropertyAccess)
                .join(Property, Property.id == PropertyAccess.property_id)
                .where(
                    PropertyAccess.property_id == property_id,
                    PropertyAccess.user_id == user_id,
                    Property.owner_id == current_user.id,
                )
                .with_for_update(of=PropertyAccess)
            )
            if access is None:
                raise HTTPException(status_code=404, detail="Участник не найден")
            session.delete(access)
            session.commit()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("", response_model=list[PropertyResponse])
def list_properties(
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[PropertyResponse]:
    """Возвращает собственные и доступные по приглашению объекты."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            rows = session.execute(
                select(Property, PropertyAccess.role)
                .outerjoin(
                    PropertyAccess,
                    and_(
                        PropertyAccess.property_id == Property.id,
                        PropertyAccess.user_id == current_user.id,
                    ),
                )
                .where(
                    or_(
                        Property.owner_id == current_user.id,
                        PropertyAccess.user_id == current_user.id,
                    )
                )
                .order_by(Property.id)
            ).all()
            return [
                to_response(
                    item, "owner" if item.owner_id == current_user.id else member_role
                )
                for item, member_role in rows
            ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

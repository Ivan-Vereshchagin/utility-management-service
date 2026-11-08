from datetime import datetime, timedelta, timezone
from hashlib import sha256
import re
from secrets import token_hex
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Property, PropertyAccess, PropertyInvitation, User
from app.properties import PropertyResponse, to_response


router = APIRouter(prefix="/properties", tags=["invitations"])
redeem_router = APIRouter(prefix="/invitations", tags=["invitations"])
INVITATION_LIFETIME = timedelta(hours=24)


class InvitationCreate(BaseModel):
    role: Literal["reader", "editor"]


class InvitationIssued(BaseModel):
    id: int
    property_id: int
    role: Literal["reader", "editor"]
    code: str
    created_at: datetime
    expires_at: datetime


class InvitationSummary(BaseModel):
    id: int
    role: Literal["reader", "editor"]
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    accepted_by_email: str | None
    revoked_at: datetime | None
    status: Literal["active", "expired", "accepted", "revoked"]


class InvitationRedeem(BaseModel):
    code: str

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.replace("-", "").replace(" ", "").upper()
        if re.fullmatch(r"[0-9A-F]{24}", normalized) is None:
            raise ValueError("Код должен содержать 24 шестнадцатеричных символа")
        return normalized


def to_summary(
    invitation: PropertyInvitation, now: datetime, accepted_by_email: str | None
) -> InvitationSummary:
    if invitation.accepted_at is not None:
        current_status = "accepted"
    elif invitation.revoked_at is not None:
        current_status = "revoked"
    elif invitation.expires_at <= now:
        current_status = "expired"
    else:
        current_status = "active"

    return InvitationSummary(
        id=invitation.id,
        role=invitation.role,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
        accepted_at=invitation.accepted_at,
        accepted_by_email=accepted_by_email,
        revoked_at=invitation.revoked_at,
        status=current_status,
    )


@router.post(
    "/{property_id}/invitations",
    response_model=InvitationIssued,
    status_code=status.HTTP_201_CREATED,
)
def create_invitation(
    payload: InvitationCreate,
    response: Response,
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> InvitationIssued:
    """Выдаёт владельцу одноразовый код приглашения для выбранной роли."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            property_item = session.scalar(
                select(Property).where(
                    Property.id == property_id, Property.owner_id == current_user.id
                )
            )
            if property_item is None:
                raise HTTPException(status_code=404, detail="Объект не найден")

            raw_code = token_hex(12).upper()
            code = "-".join(raw_code[index : index + 4] for index in range(0, 24, 4))
            invitation = PropertyInvitation(
                property_id=property_id,
                created_by_id=current_user.id,
                code_hash=sha256(raw_code.encode("ascii")).hexdigest(),
                role=payload.role,
                expires_at=datetime.now(timezone.utc) + INVITATION_LIFETIME,
            )
            session.add(invitation)
            session.flush()
            session.refresh(invitation)
            issued = InvitationIssued(
                id=invitation.id,
                property_id=invitation.property_id,
                role=invitation.role,
                code=code,
                created_at=invitation.created_at,
                expires_at=invitation.expires_at,
            )
            session.commit()
            response.headers["Cache-Control"] = "no-store"
            return issued
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("/{property_id}/invitations", response_model=list[InvitationSummary])
def list_invitations(
    response: Response,
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[InvitationSummary]:
    """Показывает владельцу приглашения без раскрытия кодов и их хешей."""
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

            invitations = session.execute(
                select(PropertyInvitation, User.email)
                .outerjoin(User, User.id == PropertyInvitation.accepted_by_id)
                .where(PropertyInvitation.property_id == property_id)
                .order_by(PropertyInvitation.created_at.desc(), PropertyInvitation.id.desc())
            ).all()
            now = datetime.now(timezone.utc)
            response.headers["Cache-Control"] = "no-store"
            return [
                to_summary(invitation, now, accepted_by_email)
                for invitation, accepted_by_email in invitations
            ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.delete(
    "/{property_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def revoke_invitation(
    property_id: int = Path(gt=0),
    invitation_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> None:
    """Отзывает неиспользованное приглашение владельца объекта."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            invitation = session.scalar(
                select(PropertyInvitation)
                .join(Property, Property.id == PropertyInvitation.property_id)
                .where(
                    PropertyInvitation.id == invitation_id,
                    PropertyInvitation.property_id == property_id,
                    Property.owner_id == current_user.id,
                )
                .with_for_update(of=PropertyInvitation)
            )
            if invitation is None:
                raise HTTPException(status_code=404, detail="Приглашение не найдено")
            if invitation.accepted_at is not None:
                raise HTTPException(status_code=409, detail="Приглашение уже использовано")
            if invitation.revoked_at is None:
                invitation.revoked_at = datetime.now(timezone.utc)
                session.commit()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@redeem_router.post(
    "/redeem", response_model=PropertyResponse, status_code=status.HTTP_201_CREATED
)
def redeem_invitation(
    payload: InvitationRedeem,
    current_user: RegisterResponse = Depends(get_current_user),
) -> PropertyResponse:
    """Присоединяет вошедшего пользователя к объекту по одноразовому коду."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    code_hash = sha256(payload.code.encode("ascii")).hexdigest()
    try:
        with Session(engine) as session:
            invitation = session.scalar(
                select(PropertyInvitation)
                .where(PropertyInvitation.code_hash == code_hash)
                .with_for_update()
            )
            now = datetime.now(timezone.utc)
            if (
                invitation is None
                or invitation.expires_at <= now
                or invitation.revoked_at is not None
                or invitation.accepted_at is not None
            ):
                raise HTTPException(status_code=404, detail="Код приглашения недействителен")

            property_item = session.get(Property, invitation.property_id)
            if property_item.owner_id == current_user.id:
                raise HTTPException(status_code=409, detail="У вас уже есть доступ к объекту")

            existing_access = session.get(
                PropertyAccess, (invitation.property_id, current_user.id)
            )
            if existing_access is not None:
                raise HTTPException(status_code=409, detail="У вас уже есть доступ к объекту")

            session.add(
                PropertyAccess(
                    property_id=invitation.property_id,
                    user_id=current_user.id,
                    role=invitation.role,
                )
            )
            invitation.accepted_at = now
            invitation.accepted_by_id = current_user.id
            joined_property = to_response(property_item, invitation.role)
            session.commit()
            return joined_property
    except IntegrityError as exc:
        constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint_name == "property_access_pkey":
            raise HTTPException(status_code=409, detail="У вас уже есть доступ к объекту") from exc
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

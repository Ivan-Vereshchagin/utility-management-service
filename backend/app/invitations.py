from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_hex
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Property, PropertyInvitation


router = APIRouter(prefix="/properties", tags=["invitations"])
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

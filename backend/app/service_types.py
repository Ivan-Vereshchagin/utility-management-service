from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import ServiceType


router = APIRouter(prefix="/service-types", tags=["service-types"])


class ServiceTypeResponse(BaseModel):
    code: str
    name: str


@router.get("", response_model=list[ServiceTypeResponse])
def list_service_types(
    _current_user: RegisterResponse = Depends(get_current_user),
) -> list[ServiceTypeResponse]:
    """Возвращает доступные виды коммунальных услуг."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            items = session.scalars(select(ServiceType).order_by(ServiceType.name)).all()
            return [ServiceTypeResponse(code=item.code, name=item.name) for item in items]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

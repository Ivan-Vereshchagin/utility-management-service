from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.accruals import require_property_read_access
from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Accrual


router = APIRouter(prefix="/properties", tags=["statistics"])


class MonthlyTotal(BaseModel):
    month: date
    total_amount: str


@router.get("/{property_id}/statistics/monthly", response_model=list[MonthlyTotal])
def list_monthly_totals(
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[MonthlyTotal]:
    """Суммирует начисления объекта по выбранному месяцу учёта."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_read_access(session, property_id, current_user.id)
            rows = session.execute(
                select(Accrual.accounting_month, func.sum(Accrual.total_amount))
                .where(Accrual.property_id == property_id)
                .group_by(Accrual.accounting_month)
                .order_by(Accrual.accounting_month)
            ).all()
            return [
                MonthlyTotal(month=month, total_amount=f"{total:.2f}")
                for month, total in rows
            ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

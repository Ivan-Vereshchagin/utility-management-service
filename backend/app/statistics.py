from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.accruals import require_property_read_access
from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Accrual, AccrualLine, ServiceType


router = APIRouter(prefix="/properties", tags=["statistics"])


class MonthlyTotal(BaseModel):
    month: date
    total_amount: str


class ServiceTotal(BaseModel):
    service_type_code: str | None
    name: str
    total_amount: str


@router.get("/{property_id}/statistics/monthly", response_model=list[MonthlyTotal])
def list_monthly_totals(
    property_id: int = Path(gt=0),
    service_type_code: str | None = Query(default=None, min_length=1, max_length=40),
    month_start: date | None = Query(default=None),
    month_end: date | None = Query(default=None),
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[MonthlyTotal]:
    """Суммирует все начисления или строки одной услуги по месяцам учёта."""
    if month_start is not None and month_start.day != 1:
        raise HTTPException(
            status_code=422, detail="Начало диапазона нужно указать первым числом месяца"
        )
    if month_end is not None and month_end.day != 1:
        raise HTTPException(
            status_code=422, detail="Конец диапазона нужно указать первым числом месяца"
        )
    if month_start is not None and month_end is not None and month_start > month_end:
        raise HTTPException(
            status_code=422, detail="Начало диапазона не может быть позже конца"
        )
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_read_access(session, property_id, current_user.id)
            filters = [Accrual.property_id == property_id]
            if month_start is not None:
                filters.append(Accrual.accounting_month >= month_start)
            if month_end is not None:
                filters.append(Accrual.accounting_month <= month_end)
            if service_type_code is None:
                rows = session.execute(
                    select(Accrual.accounting_month, func.sum(Accrual.total_amount))
                    .where(*filters)
                    .group_by(Accrual.accounting_month)
                    .order_by(Accrual.accounting_month)
                ).all()
            else:
                known_service = session.scalar(
                    select(ServiceType.code).where(ServiceType.code == service_type_code)
                )
                if known_service is None:
                    raise HTTPException(status_code=422, detail="Неизвестный вид услуги")

                months = session.scalars(
                    select(Accrual.accounting_month)
                    .where(*filters)
                    .distinct()
                    .order_by(Accrual.accounting_month)
                ).all()
                service_rows = session.execute(
                    select(Accrual.accounting_month, func.sum(AccrualLine.amount))
                    .join(AccrualLine, AccrualLine.accrual_id == Accrual.id)
                    .where(
                        *filters,
                        AccrualLine.service_type_code == service_type_code,
                    )
                    .group_by(Accrual.accounting_month)
                ).all()
                amounts = dict(service_rows)
                rows = [(month, amounts.get(month, Decimal("0.00"))) for month in months]
            return [
                MonthlyTotal(month=month, total_amount=f"{total:.2f}")
                for month, total in rows
            ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("/{property_id}/statistics/services", response_model=list[ServiceTotal])
def list_service_totals(
    property_id: int = Path(gt=0),
    month: date | None = Query(default=None),
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[ServiceTotal]:
    """Суммирует строки услуг и остаток за выбранный месяц учёта."""
    if month is not None and month.day != 1:
        raise HTTPException(status_code=422, detail="Месяц нужно указать первым числом")
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_read_access(session, property_id, current_user.id)
            filters = [Accrual.property_id == property_id]
            if month is not None:
                filters.append(Accrual.accounting_month == month)
            total = session.scalar(
                select(func.sum(Accrual.total_amount)).where(*filters)
            )
            if total is None:
                return []

            rows = session.execute(
                select(
                    AccrualLine.service_type_code,
                    ServiceType.name,
                    func.sum(AccrualLine.amount),
                )
                .select_from(AccrualLine)
                .join(Accrual, Accrual.id == AccrualLine.accrual_id)
                .join(ServiceType, ServiceType.code == AccrualLine.service_type_code)
                .where(*filters)
                .group_by(AccrualLine.service_type_code, ServiceType.name)
                .order_by(ServiceType.name, AccrualLine.service_type_code)
            ).all()
            allocated = sum((amount for _, _, amount in rows), Decimal("0.00"))
            result = [
                ServiceTotal(
                    service_type_code=code,
                    name=name,
                    total_amount=f"{amount:.2f}",
                )
                for code, name, amount in rows
            ]
            unallocated = total - allocated
            if unallocated > 0:
                result.append(
                    ServiceTotal(
                        service_type_code=None,
                        name="Без разбивки по услугам",
                        total_amount=f"{unallocated:.2f}",
                    )
                )
            return result
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import RegisterResponse, get_current_user
from app.database import get_engine
from app.models import Accrual, AccrualLine, Property, PropertyAccess, ServiceType


router = APIRouter(prefix="/properties", tags=["accruals"])
MONEY_PATTERN = r"^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$"


class AccrualLineCreate(BaseModel):
    service_type_code: str = Field(min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=255)
    amount: str = Field(pattern=MONEY_PATTERN)

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class AccrualCreate(BaseModel):
    period_start: date
    period_end: date
    total_amount: str = Field(pattern=MONEY_PATTERN)
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[AccrualLineCreate] = Field(default_factory=list)

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_notes(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @model_validator(mode="after")
    def validate_totals(self) -> "AccrualCreate":
        if self.period_start > self.period_end:
            raise ValueError("Начало периода не может быть позже его окончания")
        if sum(Decimal(line.amount) for line in self.lines) > Decimal(self.total_amount):
            raise ValueError("Сумма строк услуг превышает общую сумму начисления")
        return self


class AccrualLineResponse(BaseModel):
    id: int
    service_type_code: str
    description: str | None
    amount: str


class AccrualResponse(BaseModel):
    id: int
    property_id: int
    created_by_id: int
    period_start: date
    period_end: date
    total_amount: str
    unallocated_amount: str
    notes: str | None
    created_at: datetime
    lines: list[AccrualLineResponse]


@router.post(
    "/{property_id}/accruals",
    response_model=AccrualResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_accrual(
    payload: AccrualCreate,
    property_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> AccrualResponse:
    """Сохраняет начисление и необязательную разбивку по услугам."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            property_item = session.get(Property, property_id)
            if property_item is None:
                raise HTTPException(status_code=404, detail="Объект не найден")
            if property_item.owner_id != current_user.id:
                access = session.scalar(
                    select(PropertyAccess)
                    .where(
                        PropertyAccess.property_id == property_id,
                        PropertyAccess.user_id == current_user.id,
                    )
                    .with_for_update()
                )
                if access is None:
                    raise HTTPException(status_code=404, detail="Объект не найден")
                if access.role != "editor":
                    raise HTTPException(status_code=403, detail="Недостаточно прав")

            codes = {line.service_type_code for line in payload.lines}
            if codes:
                known_codes = set(
                    session.scalars(
                        select(ServiceType.code).where(ServiceType.code.in_(codes))
                    ).all()
                )
                unknown_codes = codes - known_codes
                if unknown_codes:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Неизвестный вид услуги: {min(unknown_codes)}",
                    )

            accrual = Accrual(
                property_id=property_id,
                created_by_id=current_user.id,
                period_start=payload.period_start,
                period_end=payload.period_end,
                total_amount=Decimal(payload.total_amount),
                notes=payload.notes,
            )
            session.add(accrual)
            session.flush()
            lines = [
                AccrualLine(
                    accrual_id=accrual.id,
                    service_type_code=line.service_type_code,
                    description=line.description,
                    amount=Decimal(line.amount),
                )
                for line in payload.lines
            ]
            session.add_all(lines)
            session.flush()
            session.refresh(accrual)

            unallocated = Decimal(payload.total_amount) - sum(
                (Decimal(line.amount) for line in payload.lines), Decimal("0")
            )
            created = AccrualResponse(
                id=accrual.id,
                property_id=property_id,
                created_by_id=current_user.id,
                period_start=accrual.period_start,
                period_end=accrual.period_end,
                total_amount=f"{accrual.total_amount:.2f}",
                unallocated_amount=f"{unallocated:.2f}",
                notes=accrual.notes,
                created_at=accrual.created_at,
                lines=[
                    AccrualLineResponse(
                        id=line.id,
                        service_type_code=line.service_type_code,
                        description=line.description,
                        amount=f"{line.amount:.2f}",
                    )
                    for line in lines
                ],
            )
            session.commit()
            return created
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

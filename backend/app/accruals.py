from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, select
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
    created_by_id: int | None
    period_start: date
    period_end: date
    total_amount: str
    unallocated_amount: str
    notes: str | None
    created_at: datetime
    lines: list[AccrualLineResponse]


def require_property_read_access(session: Session, property_id: int, user_id: int) -> None:
    """Проверяет, что пользователь владеет объектом или состоит в нём."""
    owner_id = session.scalar(select(Property.owner_id).where(Property.id == property_id))
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Объект не найден")
    if owner_id != user_id:
        access = session.scalar(
            select(PropertyAccess.user_id).where(
                PropertyAccess.property_id == property_id,
                PropertyAccess.user_id == user_id,
            )
        )
        if access is None:
            raise HTTPException(status_code=404, detail="Объект не найден")


def require_property_write_access(session: Session, property_id: int, user_id: int) -> None:
    """Проверяет право владельца или редактора изменять начисления."""
    property_item = session.get(Property, property_id)
    if property_item is None:
        raise HTTPException(status_code=404, detail="Объект не найден")
    if property_item.owner_id != user_id:
        access = session.scalar(
            select(PropertyAccess)
            .where(
                PropertyAccess.property_id == property_id,
                PropertyAccess.user_id == user_id,
            )
            .with_for_update()
        )
        if access is None:
            raise HTTPException(status_code=404, detail="Объект не найден")
        if access.role != "editor":
            raise HTTPException(status_code=403, detail="Недостаточно прав")


def validate_service_types(session: Session, lines: list[AccrualLineCreate]) -> None:
    """Проверяет, что все указанные виды услуг есть в справочнике."""
    codes = {line.service_type_code for line in lines}
    if not codes:
        return
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


def build_lines(accrual_id: int, lines: list[AccrualLineCreate]) -> list[AccrualLine]:
    """Создаёт строки начисления из подтверждённых данных запроса."""
    return [
        AccrualLine(
            accrual_id=accrual_id,
            service_type_code=line.service_type_code,
            description=line.description,
            amount=Decimal(line.amount),
        )
        for line in lines
    ]


def to_accrual_response(item: Accrual, lines: list[AccrualLine]) -> AccrualResponse:
    """Собирает ответ и вычисляет часть суммы без разбивки по услугам."""
    unallocated = item.total_amount - sum(
        (line.amount for line in lines), Decimal("0")
    )
    return AccrualResponse(
        id=item.id,
        property_id=item.property_id,
        created_by_id=item.created_by_id,
        period_start=item.period_start,
        period_end=item.period_end,
        total_amount=f"{item.total_amount:.2f}",
        unallocated_amount=f"{unallocated:.2f}",
        notes=item.notes,
        created_at=item.created_at,
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
            require_property_write_access(session, property_id, current_user.id)
            validate_service_types(session, payload.lines)

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
            lines = build_lines(accrual.id, payload.lines)
            session.add_all(lines)
            session.flush()
            session.refresh(accrual)

            created = to_accrual_response(accrual, lines)
            session.commit()
            return created
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.put("/{property_id}/accruals/{accrual_id}", response_model=AccrualResponse)
def update_accrual(
    payload: AccrualCreate,
    property_id: int = Path(gt=0),
    accrual_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> AccrualResponse:
    """Заменяет данные начисления и весь список его строк услуг."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_write_access(session, property_id, current_user.id)
            item = session.scalar(
                select(Accrual)
                .where(Accrual.id == accrual_id, Accrual.property_id == property_id)
                .with_for_update()
            )
            if item is None:
                raise HTTPException(status_code=404, detail="Начисление не найдено")
            validate_service_types(session, payload.lines)

            item.period_start = payload.period_start
            item.period_end = payload.period_end
            item.total_amount = Decimal(payload.total_amount)
            item.notes = payload.notes
            session.execute(
                delete(AccrualLine).where(AccrualLine.accrual_id == accrual_id)
            )
            lines = build_lines(accrual_id, payload.lines)
            session.add_all(lines)
            session.flush()
            updated = to_accrual_response(item, lines)
            session.commit()
            return updated
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.delete(
    "/{property_id}/accruals/{accrual_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_accrual(
    property_id: int = Path(gt=0),
    accrual_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> None:
    """Удаляет ошибочное начисление вместе с его строками услуг."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_write_access(session, property_id, current_user.id)
            item = session.scalar(
                select(Accrual)
                .where(Accrual.id == accrual_id, Accrual.property_id == property_id)
                .with_for_update()
            )
            if item is None:
                raise HTTPException(status_code=404, detail="Начисление не найдено")
            session.delete(item)
            session.commit()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("/{property_id}/accruals", response_model=list[AccrualResponse])
def list_accruals(
    property_id: int = Path(gt=0),
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    current_user: RegisterResponse = Depends(get_current_user),
) -> list[AccrualResponse]:
    """Возвращает начисления, целиком входящие в указанный период."""
    if period_start is not None and period_end is not None and period_start > period_end:
        raise HTTPException(
            status_code=422,
            detail="Начало периода фильтра не может быть позже его окончания",
        )
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_read_access(session, property_id, current_user.id)
            statement = select(Accrual).where(Accrual.property_id == property_id)
            if period_start is not None:
                statement = statement.where(Accrual.period_start >= period_start)
            if period_end is not None:
                statement = statement.where(Accrual.period_end <= period_end)
            accruals = session.scalars(
                statement.order_by(Accrual.period_start.desc(), Accrual.id.desc())
            ).all()
            if not accruals:
                return []

            lines_by_accrual: dict[int, list[AccrualLine]] = {
                item.id: [] for item in accruals
            }
            lines = session.scalars(
                select(AccrualLine)
                .where(AccrualLine.accrual_id.in_(lines_by_accrual))
                .order_by(AccrualLine.id)
            ).all()
            for line in lines:
                lines_by_accrual[line.accrual_id].append(line)
            return [
                to_accrual_response(item, lines_by_accrual[item.id]) for item in accruals
            ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc


@router.get("/{property_id}/accruals/{accrual_id}", response_model=AccrualResponse)
def get_accrual(
    property_id: int = Path(gt=0),
    accrual_id: int = Path(gt=0),
    current_user: RegisterResponse = Depends(get_current_user),
) -> AccrualResponse:
    """Возвращает одно начисление вместе со строками услуг."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="База данных не настроена")

    try:
        with Session(engine) as session:
            require_property_read_access(session, property_id, current_user.id)
            item = session.scalar(
                select(Accrual).where(
                    Accrual.id == accrual_id, Accrual.property_id == property_id
                )
            )
            if item is None:
                raise HTTPException(status_code=404, detail="Начисление не найдено")
            lines = session.scalars(
                select(AccrualLine)
                .where(AccrualLine.accrual_id == accrual_id)
                .order_by(AccrualLine.id)
            ).all()
            return to_accrual_response(item, lines)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="База данных недоступна") from exc

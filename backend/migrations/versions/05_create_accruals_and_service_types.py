from alembic import op
import sqlalchemy as sa


revision = "05"
down_revision = "04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_types",
        sa.Column("code", sa.String(length=40), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
    )
    service_types = sa.table(
        "service_types",
        sa.column("code", sa.String(length=40)),
        sa.column("name", sa.String(length=120)),
    )
    op.bulk_insert(
        service_types,
        [
            {"code": "cold_water", "name": "Холодная вода"},
            {"code": "hot_water", "name": "Горячая вода"},
            {"code": "sewerage", "name": "Водоотведение"},
            {"code": "electricity", "name": "Электроэнергия"},
            {"code": "heating", "name": "Отопление"},
            {"code": "gas", "name": "Газ"},
            {"code": "housing", "name": "Содержание жилья"},
            {"code": "capital_repairs", "name": "Капитальный ремонт"},
            {"code": "waste", "name": "Обращение с ТКО"},
            {"code": "other", "name": "Прочие услуги"},
        ],
    )

    op.create_table(
        "accruals",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "property_id",
            sa.BigInteger(),
            sa.ForeignKey("properties.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("period_start <= period_end", name="ck_accruals_period"),
        sa.CheckConstraint("total_amount >= 0", name="ck_accruals_total_amount"),
    )
    op.create_index(
        "ix_accruals_property_period",
        "accruals",
        ["property_id", "period_start", "period_end"],
    )

    op.create_table(
        "accrual_lines",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "accrual_id",
            sa.BigInteger(),
            sa.ForeignKey("accruals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "service_type_code",
            sa.String(length=40),
            sa.ForeignKey("service_types.code"),
            nullable=False,
        ),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.CheckConstraint("amount >= 0", name="ck_accrual_lines_amount"),
    )
    op.create_index("ix_accrual_lines_accrual_id", "accrual_lines", ["accrual_id"])
    op.create_index(
        "ix_accrual_lines_service_type_code", "accrual_lines", ["service_type_code"]
    )


def downgrade() -> None:
    op.drop_index("ix_accrual_lines_service_type_code", table_name="accrual_lines")
    op.drop_index("ix_accrual_lines_accrual_id", table_name="accrual_lines")
    op.drop_table("accrual_lines")
    op.drop_index("ix_accruals_property_period", table_name="accruals")
    op.drop_table("accruals")
    op.drop_table("service_types")

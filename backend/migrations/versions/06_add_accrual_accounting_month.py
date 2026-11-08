from alembic import op
import sqlalchemy as sa


revision = "06"
down_revision = "05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accruals", sa.Column("accounting_month", sa.Date(), nullable=True))
    op.execute(
        "UPDATE accruals SET accounting_month = date_trunc('month', period_end)::date"
    )
    op.alter_column("accruals", "accounting_month", nullable=False)
    op.create_check_constraint(
        "ck_accruals_accounting_month_first_day",
        "accruals",
        "EXTRACT(DAY FROM accounting_month) = 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_accruals_accounting_month_first_day", "accruals")
    op.drop_column("accruals", "accounting_month")

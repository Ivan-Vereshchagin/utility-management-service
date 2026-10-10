from alembic import op
import sqlalchemy as sa


revision = "03"
down_revision = "02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "properties",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "owner_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_properties_owner_id", "properties", ["owner_id"])

    op.create_table(
        "property_access",
        sa.Column(
            "property_id",
            sa.BigInteger(),
            sa.ForeignKey("properties.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("role IN ('reader', 'editor')", name="ck_property_access_role"),
    )
    op.create_index("ix_property_access_user_id", "property_access", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_property_access_user_id", table_name="property_access")
    op.drop_table("property_access")
    op.drop_index("ix_properties_owner_id", table_name="properties")
    op.drop_table("properties")

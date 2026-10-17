from alembic import op
import sqlalchemy as sa


revision = "04"
down_revision = "03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "property_invitations",
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
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "accepted_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("code_hash", name="uq_property_invitations_code_hash"),
        sa.CheckConstraint(
            "role IN ('reader', 'editor')", name="ck_property_invitations_role"
        ),
    )
    op.create_index(
        "ix_property_invitations_property_id", "property_invitations", ["property_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_property_invitations_property_id", table_name="property_invitations"
    )
    op.drop_table("property_invitations")

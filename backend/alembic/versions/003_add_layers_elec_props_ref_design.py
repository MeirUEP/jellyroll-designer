"""Add layers, elec_props, and reference_design_id columns to designs table

Revision ID: 003
Revises: 002
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("designs", sa.Column("layers", JSONB(), nullable=True))
    op.add_column("designs", sa.Column("elec_props", JSONB(), nullable=True))
    op.add_column(
        "designs",
        sa.Column(
            "reference_design_id",
            UUID(as_uuid=True),
            sa.ForeignKey("designs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("designs", "reference_design_id")
    op.drop_column("designs", "elec_props")
    op.drop_column("designs", "layers")

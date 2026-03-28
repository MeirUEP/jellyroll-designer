"""Initial schema - designs, simulation_results, capacity_results

Revision ID: 001
Revises:
Create Date: 2026-03-28
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "designs",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.String(10), nullable=False, server_default="1.1"),
        sa.Column("params", JSONB(), nullable=False),
        sa.Column("layers", JSONB(), nullable=False),
        sa.Column("elec_props", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_designs_created_at", "designs", ["created_at"])
    op.create_index("ix_designs_updated_at", "designs", ["updated_at"])

    op.create_table(
        "simulation_results",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("design_id", UUID(as_uuid=True), sa.ForeignKey("designs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("turns", JSONB(), nullable=False),
        sa.Column("c_tabs", JSONB(), nullable=False),
        sa.Column("a_tabs", JSONB(), nullable=False),
        sa.Column("outer_r", sa.Float(), nullable=False),
        sa.Column("min_pitch", sa.Float(), nullable=False),
        sa.Column("max_pitch", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "capacity_results",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("design_id", UUID(as_uuid=True), sa.ForeignKey("designs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("cath_cap_ah", sa.Float(), nullable=False),
        sa.Column("anod_cap_ah", sa.Float(), nullable=False),
        sa.Column("cell_cap_ah", sa.Float(), nullable=False),
        sa.Column("np_ratio", sa.Float(), nullable=False),
        sa.Column("cell_energy_1e", sa.Float(), nullable=False),
        sa.Column("total_dry_mass", sa.Float(), nullable=False),
        sa.Column("full_result", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("capacity_results")
    op.drop_table("simulation_results")
    op.drop_table("designs")

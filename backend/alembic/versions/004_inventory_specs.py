"""Expand inventory_items with spec columns for feasibility math

Adds: density, capacity, is_active_mat (raw_chemical specs),
       thickness_mm, width_mm (separator/collector/tab specs),
       color (separator/collector).

Revision ID: 004
Revises: 003
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa


revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_items", sa.Column("density", sa.Float(), nullable=True))
    op.add_column("inventory_items", sa.Column("capacity", sa.Float(), nullable=True))
    op.add_column(
        "inventory_items",
        sa.Column("is_active_mat", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("inventory_items", sa.Column("thickness_mm", sa.Float(), nullable=True))
    op.add_column("inventory_items", sa.Column("width_mm", sa.Float(), nullable=True))
    op.add_column("inventory_items", sa.Column("color", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_items", "color")
    op.drop_column("inventory_items", "width_mm")
    op.drop_column("inventory_items", "thickness_mm")
    op.drop_column("inventory_items", "is_active_mat")
    op.drop_column("inventory_items", "capacity")
    op.drop_column("inventory_items", "density")

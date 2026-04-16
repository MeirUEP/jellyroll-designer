"""Add cost_per_unit to inventory_items for BOM costing

Revision ID: 005
Revises: 004
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa


revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cost is per 1 `unit` of the item (e.g. $/kg if unit is kg, $/ft if unit is ft).
    op.add_column("inventory_items", sa.Column("cost_per_unit", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_items", "cost_per_unit")

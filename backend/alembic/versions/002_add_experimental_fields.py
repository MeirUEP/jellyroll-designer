"""Add experimental fields to designs table

Revision ID: 002
Revises: 001
Create Date: 2026-04-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("designs", sa.Column("is_experimental", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("designs", sa.Column("experimental_data", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("designs", "experimental_data")
    op.drop_column("designs", "is_experimental")

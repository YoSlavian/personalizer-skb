"""dataset fields: owned products, foreign trade, dataset uid

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-25 20:10:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('dataset_uid', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('owned_products', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('foreign_trade', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.create_index(batch_op.f('ix_organizations_dataset_uid'), ['dataset_uid'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_organizations_dataset_uid'))
        batch_op.drop_column('foreign_trade')
        batch_op.drop_column('owned_products')
        batch_op.drop_column('dataset_uid')

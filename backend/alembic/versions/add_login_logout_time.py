"""add login and logout time to users

Revision ID: add_login_logout_time
Revises: b2c4e7a91d38
Create Date: 2026-09-10
"""

from alembic import op
import sqlalchemy as sa


revision = "add_login_logout_time"
down_revision = "b2c4e7a91d38"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "login_time",
            sa.DateTime(),
            nullable=True,
        ),
    )

    op.add_column(
        "users",
        sa.Column(
            "logout_time",
            sa.DateTime(),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("users", "logout_time")
    op.drop_column("users", "login_time")
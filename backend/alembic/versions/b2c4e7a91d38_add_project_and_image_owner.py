"""add owner to projects and images

Projects and images used to belong to nobody, so every signed-in user could
read, edit and delete everyone else's work. This gives both tables an owner and
makes project names unique per owner rather than globally.

Existing rows are handed to the earliest account, since there is no record of
who created them. Check that assignment after upgrading a shared database.

Revision ID: b2c4e7a91d38
Revises: ae155c13772f
Create Date: 2026-09-09 08:15:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c4e7a91d38"
down_revision: Union[str, None] = "ae155c13772f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The original migration wrote UNIQUE(name) without naming it, so on SQLite
# there is no constraint name to drop. This convention lets batch mode work out
# what the anonymous one would have been called.
NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    connection = op.get_bind()
    first_user = connection.execute(sa.text("SELECT MIN(id) FROM users")).scalar()

    for table in ("projects", "images"):
        # Added nullable so existing rows survive, backfilled, then locked down.
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))

        if first_user is None:
            # No accounts means no real data to keep; anything here is orphaned.
            connection.execute(sa.text(f"DELETE FROM {table}"))
        else:
            connection.execute(
                sa.text(f"UPDATE {table} SET owner_id = :uid WHERE owner_id IS NULL"),
                {"uid": first_user},
            )

    with op.batch_alter_table(
        "projects", schema=None, naming_convention=NAMING
    ) as batch_op:
        batch_op.alter_column("owner_id", existing_type=sa.Integer(), nullable=False)
        # A name only has to be unique within one person's projects now.
        batch_op.drop_constraint("uq_projects_name", type_="unique")
        batch_op.create_unique_constraint("uq_projects_owner_name", ["owner_id", "name"])
        batch_op.create_foreign_key(
            "fk_projects_owner_id_users", "users", ["owner_id"], ["id"]
        )
        batch_op.create_index("ix_projects_owner_id", ["owner_id"], unique=False)

    with op.batch_alter_table("images", schema=None) as batch_op:
        batch_op.alter_column("owner_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            "fk_images_owner_id_users", "users", ["owner_id"], ["id"]
        )
        batch_op.create_index("ix_images_owner_id", ["owner_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("images", schema=None) as batch_op:
        batch_op.drop_index("ix_images_owner_id")
        batch_op.drop_constraint("fk_images_owner_id_users", type_="foreignkey")
        batch_op.drop_column("owner_id")

    with op.batch_alter_table(
        "projects", schema=None, naming_convention=NAMING
    ) as batch_op:
        batch_op.drop_index("ix_projects_owner_id")
        batch_op.drop_constraint("fk_projects_owner_id_users", type_="foreignkey")
        batch_op.drop_constraint("uq_projects_owner_name", type_="unique")
        batch_op.create_unique_constraint("uq_projects_name", ["name"])
        batch_op.drop_column("owner_id")

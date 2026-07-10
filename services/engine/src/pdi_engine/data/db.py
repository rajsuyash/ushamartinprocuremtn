"""Connection + query helpers for the engine's data-access layer.

Deliberately no SQLAlchemy: `pandas.read_sql` only accepts a SQLAlchemy
Connectable or `sqlite3.Connection` for the DBAPI2 fast-path; a bare psycopg3
connection falls through to a slower, warning-emitting path. Since every
reader here already needs full control of the SQL (named filters, joins), a
manual cursor -> DataFrame helper is both simpler and avoids adding a
dependency whose only job would be routing around this.
"""
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

import pandas as pd
import psycopg

from ..config import get_settings


@contextmanager
def get_connection() -> Generator[psycopg.Connection, None, None]:
    """Open a psycopg connection to the configured database; closed on exit."""
    conn = psycopg.connect(get_settings().database_url)
    try:
        yield conn
    finally:
        conn.close()


def query_df(sql: str, params: dict[str, Any] | None = None) -> pd.DataFrame:
    """Run a query and return the result set as a DataFrame.

    Column names/order come from `cursor.description`, so callers get exactly
    the columns their `SELECT` names — no implicit renaming.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
    return pd.DataFrame(rows, columns=columns)

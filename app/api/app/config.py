"""The API's settings: one required setting, read when the application starts.

Blueprint section 6 is the authority for the setting and section 12.4 for the
names here: ``Settings``, ``load_settings`` and ``ConfigError``.

Nothing in this module reads the environment at import time. ``load_settings``
is called from the lifespan start-up of ``app.main``, so a test may set
``DATABASE_URL`` first and the server reads it when it starts and not before.
A failure names the setting that is wrong and never echoes its value: the URL
carries the database password (blueprint 5.4).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

#: The one setting the API reads (blueprint section 6). Required at start.
DATABASE_URL = "DATABASE_URL"

#: Blueprint section 6: the URL must begin like this, naming the psycopg 3
#: driver that ``app.db.make_engine`` is written for.
DATABASE_URL_PREFIX = "postgresql+psycopg://"


class ConfigError(Exception):
    """A required setting is missing or malformed.

    The message names the setting and does not contain its value, so it is safe
    to print on the way out of a failed start-up (blueprint 5.4, 12.4).
    """


@dataclass(frozen=True)
class Settings:
    """What the API was started with."""

    database_url: str


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    """The settings read from ``environ``, or from ``os.environ`` when None.

    ``ConfigError`` when ``DATABASE_URL`` is absent or empty, or does not begin
    with ``postgresql+psycopg://`` followed by the rest of a URL. Nothing more is
    checked here: whether the database it names can be reached is found out by
    ``app.db.initialise``, which runs next at start-up.
    """
    source = os.environ if environ is None else environ
    raw = source.get(DATABASE_URL)
    if raw is None or raw == "":
        raise ConfigError(
            f"{DATABASE_URL} is not set; it must be a {DATABASE_URL_PREFIX} URL"
        )
    if not raw.startswith(DATABASE_URL_PREFIX) or raw == DATABASE_URL_PREFIX:
        raise ConfigError(
            f"{DATABASE_URL} is malformed; it must begin with {DATABASE_URL_PREFIX} "
            "and name a database"
        )
    return Settings(database_url=raw)

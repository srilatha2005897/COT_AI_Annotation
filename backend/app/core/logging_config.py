import logging
import sys

_CONFIGURED = False


def configure_logging(level: str = "INFO") -> None:
    """Set up a single console handler for the whole app.

    Called once from app startup. Uvicorn's own loggers are left alone.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)-8s %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # Ultralytics is very chatty at INFO.
    logging.getLogger("ultralytics").setLevel(logging.WARNING)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)

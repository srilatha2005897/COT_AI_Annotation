import base64
import hashlib
import hmac
import json
import secrets
import time

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"pbkdf2_sha256$120000${salt.hex()}${digest.hex()}"


# Hash of a random value, compared against when the email doesn't exist, so
# login timing doesn't leak which emails are registered.
_DUMMY_HASH = hash_password("annotateai-timing-placeholder")


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def create_user(
    db: Session,
    name: str,
    email: str,
    password: str,
    role: str = "user",
) -> User:
    user = User(
        name=name.strip(),
        email=email.strip().lower(),
        password_hash=hash_password(password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if not user:
        # Compare anyway, so a missing email costs the same as a wrong password.
        verify_password(password, _DUMMY_HASH)
        return None
    if verify_password(password, user.password_hash):
        return user
    return None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_access_token(user: User, expires_in: int | None = None) -> str:
    if expires_in is None:
        expires_in = settings.access_token_ttl_seconds
    payload = {
        "sub": user.id,
        "exp": int(time.time()) + expires_in,
    }
    raw = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(
        settings.token_secret.encode(),
        raw.encode(),
        hashlib.sha256,
    ).digest()
    return f"{raw}.{_b64(signature)}"


def get_user_from_token(db: Session, token: str) -> User | None:
    try:
        raw, signature = token.split(".", 1)
        expected = hmac.new(
            settings.token_secret.encode(),
            raw.encode(),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_unb64(signature), expected):
            return None
        payload = json.loads(_unb64(raw).decode())
        if int(payload["exp"]) < int(time.time()):
            return None
        return db.get(User, int(payload["sub"]))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None

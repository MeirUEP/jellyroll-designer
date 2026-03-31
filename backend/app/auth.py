import hashlib
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.config import get_settings

security = HTTPBearer(auto_error=False)


def _hash_key(key: str) -> str:
    """SHA-256 hash of an API key."""
    return hashlib.sha256(key.encode()).hexdigest()


async def verify_api_key(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> str:
    settings = get_settings()
    if not credentials:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    # Support both raw key comparison (legacy) and hashed key comparison
    incoming = credentials.credentials
    stored = settings.api_key
    # If stored key looks like a SHA-256 hash (64 hex chars), compare hashes
    if len(stored) == 64 and all(c in '0123456789abcdef' for c in stored):
        if _hash_key(incoming) != stored:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")
    else:
        # Plaintext comparison (legacy fallback)
        if incoming != stored:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return incoming

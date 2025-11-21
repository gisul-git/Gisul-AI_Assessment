from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .core.config import get_settings
from .db.mongo import close_mongo_connection, connect_to_mongo, get_database
from .routers import assessments, auth, candidate, users

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title=settings.app_name, version="1.0.0")

# Rate Limiting Setup
limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS Configuration
# Read from environment variable, fallback to default
cors_origins_str = settings.cors_origins
# All allowed origins (local, Vercel, and production)
cors_origins_list = [
    "http://localhost:3000",  # Local development
    "https://gisul-ai-assessment.vercel.app",  # Vercel deployment (update with your actual Vercel URL)
    "https://yourdomain.com"  # Production domain (update with your actual domain)
]

# Parse comma-separated origins from environment variable (takes precedence if set)
if cors_origins_str and cors_origins_str != "http://localhost:3000":
    cors_origins_list = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list,  # Restricted to specific origins
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=True,
    expose_headers=["*"],
)

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],        # allow everyone (testing only)
#     allow_methods=["*"],
#     allow_headers=["*"],
#     allow_credentials=True,
# )

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    # Security headers
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    
    # Strict Transport Security (only in production/HTTPS)
    if request.url.scheme == "https" or settings.debug is False:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    
    # Content Security Policy
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;"
    
    return response


@app.on_event("startup")
async def startup() -> None:
    await connect_to_mongo()
    db = get_database()
    # Ensure indexes
    await db.users.create_index("email", unique=True)
    await db.otps.create_index("expiresAt", expireAfterSeconds=0)
    await db.assessments.create_index("organization")
    logger.info("MongoDB connected and indexes ensured")


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_mongo_connection()


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.error(f"Validation error for {request.url.path}: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={
            "success": False, 
            "message": "Validation error", 
            "errors": exc.errors(),
            "detail": str(exc)
        },
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc: Any) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={
            "success": False,
            "message": f"Route {request.url.path} not found",
        },
    )


@app.get("/")
@app.head("/")
async def root() -> dict[str, Any]:
    return {
        "message": "AI Assessment API is running successfully!",
        "timestamp": _now_iso(),
        "status": "healthy",
    }


@app.get("/health")
@app.head("/health")
async def health_check() -> dict[str, Any]:
    return {
        "message": "✅ Health check passed",
        "timestamp": _now_iso(),
        "status": "healthy",
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


# Initialize rate limiter in auth router
from .routers import auth as auth_router
auth_router.set_limiter(limiter)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(assessments.router)
app.include_router(candidate.router)


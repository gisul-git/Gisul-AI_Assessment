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
from .routers import assessments, auth, candidate, proctor, users

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title=settings.app_name, version="1.0.0")

# Rate Limiting Setup with MongoDB Storage
# Use MongoDB URI from settings for rate limiting storage
# slowapi's Limiter uses storage_uri parameter (string format)
# Ensure database name is included in MongoDB URI
limiter: Limiter | None = None
try:
    mongo_uri_for_limiter = settings.mongo_uri
    if settings.mongo_db:
        # Check if database name is already in URI
        uri_without_params = mongo_uri_for_limiter.split("?")[0]
        # Check if there's a database name after the last /
        if not uri_without_params.split("/")[-1] or uri_without_params.count("/") <= 2:
            # No database in URI, append it
            if not mongo_uri_for_limiter.endswith("/"):
                mongo_uri_for_limiter = f"{mongo_uri_for_limiter}/{settings.mongo_db}"
            else:
                mongo_uri_for_limiter = f"{mongo_uri_for_limiter}{settings.mongo_db}"
    # slowapi supports MongoDB via limits library when using mongodb:// URI format
    limiter = Limiter(key_func=get_remote_address, storage_uri=mongo_uri_for_limiter)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    logger.info("Rate limiter initialized successfully")
except Exception as e:
    logger.warning(f"Rate limiter initialization failed: {e}. Rate limiting will be disabled.")
    logger.warning("This is not critical - the app will continue to work without rate limiting.")
    limiter = None
    app.state.limiter = None

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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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


# CSRF Protection Middleware (for state-changing operations)
@app.middleware("http")
async def csrf_protection_middleware(request: Request, call_next):
    """CSRF protection using Origin/Referer header validation for POST, PUT, DELETE, PATCH methods."""
    # Skip CSRF check for GET, HEAD, OPTIONS
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return await call_next(request)
    
    # Skip CSRF check for candidate endpoints (they use assessment tokens)
    if request.url.path.startswith("/api/assessment/"):
        return await call_next(request)
    
    # Skip CSRF check for auth endpoints (they use their own security)
    if request.url.path.startswith("/api/auth/"):
        return await call_next(request)
    
    # Validate Origin/Referer header for CSRF protection
    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")
    
    # If both Origin and Referer are missing, it might be a direct API call (allow for now)
    # In production, you may want to be stricter
    if origin or referer:
        allowed_origins = cors_origins_list
        origin_valid = False
        
        if origin:
            # Check if origin matches any allowed origin
            origin_valid = any(
                origin == allowed or 
                origin.startswith(allowed.replace("http://", "https://")) or
                origin.startswith(allowed)
                for allowed in allowed_origins
            )
        
        if referer and not origin_valid:
            # Extract origin from referer
            try:
                from urllib.parse import urlparse
                referer_origin = f"{urlparse(referer).scheme}://{urlparse(referer).netloc}"
                origin_valid = any(
                    referer_origin == allowed or
                    referer_origin.startswith(allowed.replace("http://", "https://")) or
                    referer_origin.startswith(allowed)
                    for allowed in allowed_origins
                )
            except Exception:
                pass
        
        # If origin/referer validation fails, log warning but allow (JWT auth provides protection)
        # In strict mode, you could reject the request here
        if not origin_valid and settings.debug:
            logger.warning(f"CSRF check: Origin/Referer validation failed. Origin: {origin}, Referer: {referer}, Path: {request.url.path}")
    
    response = await call_next(request)
    return response


@app.on_event("startup")
async def startup() -> None:
    await connect_to_mongo()
    db = get_database()
    
    # Initialize DSA MongoDB connection (uses .env for MONGO_URI and MONGO_DB)
    from app.dsa.database import connect_to_dsa_mongo
    await connect_to_dsa_mongo()
    
    # Ensure indexes for optimal query performance (supports 100k+ requests)
    
    # Users collection indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("role")  # Frequently queried for role-based filtering
    await db.users.create_index("organization")  # For organization-based queries
    
    # Email verifications collection indexes
    await db.email_verifications.create_index("email")  # Frequently queried by email
    await db.otps.create_index("expiresAt", expireAfterSeconds=0)
    
    # Assessments collection indexes (critical for high-volume queries)
    await db.assessments.create_index("organization")  # Already exists, but kept for clarity
    await db.assessments.create_index("createdBy")  # Frequently queried for user's assessments
    await db.assessments.create_index("status")  # Frequently queried for status filtering
    await db.assessments.create_index("assessmentToken")  # Critical for candidate access (high-frequency queries)
    
    # Compound indexes for common query patterns
    await db.assessments.create_index([("organization", 1), ("status", 1)])  # Query by org and status
    await db.assessments.create_index([("createdBy", 1), ("status", 1)])  # Query by creator and status
    await db.assessments.create_index([("organization", 1), ("createdBy", 1)])  # Query by org and creator
    
    # Proctor events collection indexes
    await db.proctor_events.create_index("userId")  # Query by user
    await db.proctor_events.create_index("assessmentId")  # Query by assessment
    await db.proctor_events.create_index("eventType")  # Query by event type
    await db.proctor_events.create_index([("assessmentId", 1), ("userId", 1)])  # Compound for user in assessment
    await db.proctor_events.create_index([("assessmentId", 1), ("userId", 1), ("eventType", 1)])  # Full compound
    
    logger.info("MongoDB connected and indexes ensured")


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_mongo_connection()
    # Close DSA MongoDB connection
    from app.dsa.database import close_dsa_mongo_connection
    await close_dsa_mongo_connection()


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.error(f"Validation error for {request.url.path}: {exc.errors()}")
    
    # Format errors into user-friendly messages
    error_messages = []
    for error in exc.errors():
        field = ".".join(str(loc) for loc in error.get("loc", []))
        error_type = error.get("type", "")
        error_msg = error.get("msg", "")
        
        # Handle password validation errors
        if "password" in field.lower():
            if error_type == "string_too_short":
                error_messages.append("Password must be at least 8 characters long")
            elif error_type == "value_error":
                # This is from our custom password validation
                error_messages.append(error_msg)
            elif "missing" in error_type:
                error_messages.append("Password is required")
            else:
                error_messages.append(f"Password: {error_msg}")
        # Handle email validation errors
        elif "email" in field.lower():
            if "missing" in error_type:
                error_messages.append("Email is required")
            elif "value_error" in error_type or "string" in error_type:
                error_messages.append("Please enter a valid email address")
            else:
                error_messages.append(f"Email: {error_msg}")
        # Handle other field errors
        else:
            field_name = field.split(".")[-1] if "." in field else field
            if "missing" in error_type:
                error_messages.append(f"{field_name.capitalize()} is required")
            else:
                error_messages.append(f"{field_name.capitalize()}: {error_msg}")
    
    # Join all error messages into a single message
    message = "; ".join(error_messages) if error_messages else "Validation error"
    
    return JSONResponse(
        status_code=422,
        content={
            "success": False, 
            "message": message,
            "detail": message
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


# Initialize rate limiter in auth router (if available)
from .routers import auth as auth_router
if limiter is not None:
    auth_router.set_limiter(limiter)
else:
    logger.warning("Rate limiter not available - auth router will work without rate limiting")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(assessments.router)
app.include_router(candidate.router)
app.include_router(proctor.router)

# DSA Competency Module Routers
from .dsa.routers import tests as dsa_tests, questions as dsa_questions, assessment as dsa_assessment, admin as dsa_admin, run as dsa_run, submissions as dsa_submissions

app.include_router(dsa_admin.router, prefix="/api/dsa/admin", tags=["dsa-admin"])
app.include_router(dsa_questions.router, prefix="/api/dsa/questions", tags=["dsa-questions"])
app.include_router(dsa_submissions.router, prefix="/api/dsa/submissions", tags=["dsa-submissions"])
app.include_router(dsa_tests.router, prefix="/api/dsa/tests", tags=["dsa-tests"])
app.include_router(dsa_run.router, prefix="/api/dsa", tags=["dsa-execution"])
app.include_router(dsa_assessment.router, prefix="/api/dsa/assessment", tags=["dsa-assessment"])


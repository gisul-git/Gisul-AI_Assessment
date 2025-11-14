from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import get_settings
from .db.mongo import close_mongo_connection, connect_to_mongo, get_database
from .routers import assessments, auth, users

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title=settings.app_name, version="1.0.0")

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


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
    return JSONResponse(
        status_code=422,
        content={"success": False, "message": "Validation error", "errors": exc.errors()},
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


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(assessments.router)


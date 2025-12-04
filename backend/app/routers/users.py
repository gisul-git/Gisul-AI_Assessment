from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from ..core.dependencies import get_current_user, require_editor, require_org_admin, require_super_admin
from ..core.security import get_password_hash, sanitize_text_field
from ..db.mongo import get_db
from ..models.constants import USER_ROLES
from ..schemas.user import UserProfileUpdateRequest, UserRegisterRequest, UserStatusUpdateRequest
from ..utils.mongo import serialize_document, to_object_id
from ..utils.responses import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["users"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@router.get("/me")
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return success_response("User profile fetched successfully", current_user)


@router.post("/register")
async def register_user(
    payload: UserRegisterRequest,
    current_user: Dict[str, Any] = Depends(require_org_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if payload.role not in {"org_admin", "editor", "viewer"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    email = _normalize_email(payload.email)
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User already exists")

    organization_id: ObjectId | None = None
    if payload.organizationId:
        try:
            organization_id = to_object_id(payload.organizationId)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid organization ID") from exc

        organization = await db.organizations.find_one({"_id": organization_id})
        if not organization:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    elif current_user.get("organization"):
        try:
            organization_id = to_object_id(current_user.get("organization"))
        except ValueError:
            organization_id = None

    # Sanitize user name to prevent XSS
    sanitized_name = sanitize_text_field(payload.name)
    
    user_doc: Dict[str, Any] = {
        "name": sanitized_name,
        "email": email,
        "password": get_password_hash(payload.password),
        "role": payload.role,
        "organization": organization_id,
        "tierAccess": "Free",
        "createdAt": datetime.now(timezone.utc),
    }

    result = await db.users.insert_one(user_doc)
    created = await db.users.find_one({"_id": result.inserted_id}, {"password": 0})
    return success_response("User registered successfully", serialize_document(created), status_code=status.HTTP_201_CREATED)


@router.get("/all")
async def get_all_users(
    current_user: Dict[str, Any] = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    cursor = db.users.find({}, {"password": 0}).sort("createdAt", -1)
    users = [serialize_document(doc) async for doc in cursor]
    return success_response("Users fetched successfully", users)


@router.get("/org-admins")
async def get_org_admins(
    current_user: Dict[str, Any] = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get all organization admins with their assessment counts and details."""
    # Get all org_admin users
    cursor = db.users.find({"role": "org_admin"}, {"password": 0}).sort("createdAt", -1)
    org_admins = []
    
    async for doc in cursor:
        admin_data = serialize_document(doc)
        admin_id = admin_data.get("id")
        
        # Build query for assessments - check both createdBy and organization
        query_conditions = [{"createdBy": to_object_id(admin_id)}]
        
        # If admin has an organization, also search by organization
        admin_org = admin_data.get("organization")
        if admin_org:
            try:
                # Try to convert to ObjectId if it's a string
                org_id = to_object_id(admin_org) if isinstance(admin_org, str) else admin_org
                query_conditions.append({"organization": org_id})
            except (ValueError, TypeError):
                # If conversion fails, just use createdBy
                pass
        
        query = {"$or": query_conditions} if len(query_conditions) > 1 else query_conditions[0]
        
        # Count assessments
        assessment_count = await db.assessments.count_documents(query)
        
        # Get assessment details
        assessment_cursor = db.assessments.find(
            query,
            {"title": 1, "status": 1, "createdAt": 1, "updatedAt": 1}
        ).sort("createdAt", -1)
        
        assessments = [serialize_document(assess_doc) async for assess_doc in assessment_cursor]
        
        admin_data["assessmentCount"] = assessment_count
        admin_data["assessments"] = assessments
        org_admins.append(admin_data)
    
    return success_response(
        f"Found {len(org_admins)} organization admin(s)",
        {
            "total": len(org_admins),
            "orgAdmins": org_admins,
        }
    )


@router.get("/role/{role}")
async def get_users_by_role(
    role: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if role not in USER_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    cursor = db.users.find({"role": role}, {"password": 0}).sort("createdAt", -1)
    users = [serialize_document(doc) async for doc in cursor]
    return success_response(f"Users with role {role} fetched successfully", users)


@router.put("/status/{user_id}")
async def update_user_status(
    user_id: str,
    payload: UserStatusUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = to_object_id(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID") from exc

    updates: Dict[str, Any] = {}
    if payload.role:
        if payload.role not in USER_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
        updates["role"] = payload.role

    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid fields to update")

    result = await db.users.find_one_and_update(
        {"_id": oid},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return success_response("User status updated successfully", serialize_document(result))


@router.put("/profile/{user_id}")
async def update_user_profile(
    user_id: str,
    payload: UserProfileUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = to_object_id(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID") from exc

    if current_user.get("role") != "super_admin" and current_user.get("id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    # Sanitize name field if present
    if "name" in updates and updates["name"]:
        updates["name"] = sanitize_text_field(updates["name"])
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    result = await db.users.find_one_and_update(
        {"_id": oid},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return success_response("Profile updated successfully", serialize_document(result))


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = to_object_id(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID") from exc

    if current_user.get("role") != "super_admin" and current_user.get("id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    result = await db.users.find_one_and_delete({"_id": oid})
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return success_response("User deleted successfully")

import hashlib
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import FaceEmbedding, Student
from app.services.face_engine import MAX_IMAGE_BYTES, embedding_from_image, is_valid_embedding

router = APIRouter(prefix="/face", tags=["Face Recognition"])


@router.get("/me/status")
def my_face_status(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if current_user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student access required.")
    student = db.query(Student).filter(
        func.lower(Student.email) == str(current_user.get("email", "")).lower(),
        Student.is_active.is_(True),
    ).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Active student profile not found.")
    registration = (
        db.query(
            FaceEmbedding.status,
            FaceEmbedding.registered_at,
            FaceEmbedding.embedding_json,
        )
        .filter(FaceEmbedding.student_id == student.id)
        .first()
    )
    ready = bool(
        registration
        and registration.status == "registered"
        and is_valid_embedding(registration.embedding_json)
    )
    return {
        "face_registered": ready,
        "status": "registered" if ready else "not_registered",
        "registered_at": registration.registered_at if ready else None,
    }


@router.post("/me/register", status_code=status.HTTP_201_CREATED)
async def register_my_face(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Register the authenticated student's own face reference."""
    if current_user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student access required.")

    student = db.query(Student).filter(
        func.lower(Student.email) == str(current_user.get("email", "")).lower(),
        Student.is_active.is_(True),
    ).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Active student profile not found.")

    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WEBP camera image.")
    image_data = await file.read(MAX_IMAGE_BYTES + 1)
    if not image_data or len(image_data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="The face image is empty or exceeds the 5 MB limit.")

    image_hash = hashlib.sha256(image_data).hexdigest()
    duplicate = db.query(FaceEmbedding.id).filter(
        FaceEmbedding.image_sha256 == image_hash,
        FaceEmbedding.student_id != student.id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This image is already registered to another student.")

    try:
        embedding = embedding_from_image(image_data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (RuntimeError, AttributeError) as exc:
        raise HTTPException(status_code=503, detail="Face recognition models are unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="The captured image could not be processed.") from exc

    if not is_valid_embedding(embedding):
        raise HTTPException(status_code=422, detail="A valid SFace embedding could not be generated.")

    registration = db.query(FaceEmbedding).filter(
        FaceEmbedding.student_id == student.id
    ).first()
    if registration is None:
        registration = FaceEmbedding(student_id=student.id)
        db.add(registration)
    registration.image_data = image_data
    registration.mime_type = file.content_type or "image/jpeg"
    registration.image_sha256 = image_hash
    registration.embedding_json = json.dumps(embedding)
    registration.status = "registered"

    try:
        db.commit()
        db.refresh(registration)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to save face registration because this image is already in use.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unable to save face registration.") from exc

    return {
        "face_registered": True,
        "status": "registered",
        "registered_at": registration.registered_at,
    }

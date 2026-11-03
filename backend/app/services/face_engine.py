"""Real YuNet/SFace processing shared by registration and verification."""
import json
import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "face"
DETECTOR_PATH = Path(os.getenv("ATTENDX_YUNET_MODEL", str(MODEL_DIR / "face_detection_yunet_2023mar.onnx")))
RECOGNIZER_PATH = Path(os.getenv("ATTENDX_SFACE_MODEL", str(MODEL_DIR / "face_recognition_sface_2021dec.onnx")))
MAX_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_THRESHOLD = float(os.getenv("ATTENDX_FACE_THRESHOLD", "0.363"))
DEFAULT_MARGIN = float(os.getenv("ATTENDX_FACE_AMBIGUITY_MARGIN", "0.04"))


@lru_cache(maxsize=1)
def _models():
    if not DETECTOR_PATH.is_file() or not RECOGNIZER_PATH.is_file():
        raise RuntimeError("YuNet and SFace model files are unavailable.")
    detector = cv2.FaceDetectorYN.create(str(DETECTOR_PATH), "", (320, 320), 0.8, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(str(RECOGNIZER_PATH), "")
    return detector, recognizer


def embedding_from_image(data: bytes) -> list[float]:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image is empty or exceeds the 5 MB limit.")
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or min(image.shape[:2]) < 80:
        raise ValueError("Image content is invalid or too small to process.")
    detector, recognizer = _models()
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None or len(faces) == 0:
        raise ValueError("No face detected. Use a clear, front-facing photo.")
    if len(faces) != 1:
        raise ValueError("Multiple faces detected. Upload an image with one person.")
    aligned = recognizer.alignCrop(image, faces[0])
    vector = np.asarray(recognizer.feature(aligned), dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if vector.size != 128 or not np.isfinite(vector).all() or norm < 1e-8:
        raise ValueError("SFace could not produce a valid face embedding.")
    return (vector / norm).astype(float).tolist()


def decode_embedding(value) -> np.ndarray | None:
    try:
        values = json.loads(value) if isinstance(value, str) else value
        vector = np.asarray(values, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vector))
        if vector.size != 128 or not np.isfinite(vector).all() or norm < 1e-8:
            return None
        return vector / norm
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def is_valid_embedding(value) -> bool:
    """True only for a finite, unit-normalized 128-value stored vector."""
    try:
        values = json.loads(value) if isinstance(value, str) else value
        vector = np.asarray(values, dtype=np.float64).reshape(-1)
        norm = float(np.linalg.norm(vector))
        return bool(
            vector.size == 128
            and np.isfinite(vector).all()
            and 0.999 <= norm <= 1.001
        )
    except (ValueError, TypeError, json.JSONDecodeError):
        return False


def identify_embedding(query, registrations, threshold=None, margin=None):
    query_vector = decode_embedding(query)
    if query_vector is None:
        return None, "invalid_embedding", None
    threshold = DEFAULT_THRESHOLD if threshold is None else float(threshold)
    margin = DEFAULT_MARGIN if margin is None else float(margin)
    if not -1 <= threshold <= 1 or not 0 <= margin <= 2:
        raise ValueError("Face matching threshold configuration is invalid.")
    scores = []
    for student_id, stored in registrations:
        vector = decode_embedding(stored)
        if vector is not None:
            scores.append((float(np.dot(query_vector, vector)), student_id))
    scores.sort(reverse=True)
    if not scores:
        return None, "no_registered_embeddings", None
    score, student_id = scores[0]
    if score < threshold:
        return None, "unknown_face", score
    if len(scores) > 1 and score - scores[1][0] < margin:
        return None, "ambiguous_face", score
    return student_id, "matched", score

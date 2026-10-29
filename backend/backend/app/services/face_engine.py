import base64
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
        raise RuntimeError("YuNet/SFace model files are missing. Configure ATTENDX_YUNET_MODEL and ATTENDX_SFACE_MODEL.")
    detector = cv2.FaceDetectorYN.create(str(DETECTOR_PATH), "", (320, 320), 0.8, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(str(RECOGNIZER_PATH), "")
    return detector, recognizer

def decode_image(data):
    if isinstance(data, str):
        if data.startswith("data:"):
            if "," not in data:
                raise ValueError("Invalid image data URL.")
            data = data.split(",", 1)[1]
        try:
            data = base64.b64decode(data, validate=True)
        except Exception as exc:
            raise ValueError("Image must contain valid base64 data.") from exc
    if not isinstance(data, (bytes, bytearray)) or not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image is empty or exceeds the 5 MB limit.")
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or min(image.shape[:2]) < 80:
        raise ValueError("Invalid image or insufficient resolution.")
    return image

def embedding_from_image(data):
    image = decode_image(data)
    detector, recognizer = _models()
    h, w = image.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(image)
    if faces is None or len(faces) == 0:
        raise ValueError("No face detected. Capture a clear, front-facing image.")
    if len(faces) != 1:
        raise ValueError("Multiple faces detected. Only one person may be registered.")
    aligned = recognizer.alignCrop(image, faces[0])
    feature = np.asarray(recognizer.feature(aligned), dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(feature))
    if feature.size != 128 or not np.isfinite(feature).all() or norm < 1e-8:
        raise ValueError("SFace failed to generate a valid 128-dimensional embedding.")
    return (feature / norm).astype(float).tolist()

def _vector(value):
    try:
        vector = np.asarray(json.loads(value) if isinstance(value, str) else value, dtype=np.float32).reshape(-1)
        if vector.size != 128 or not np.isfinite(vector).all():
            return None
        norm = float(np.linalg.norm(vector))
        return vector / norm if norm > 1e-8 else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None

def identify_embedding(query_embedding, registrations, threshold=None, margin=None):
    query = _vector(query_embedding)
    if query is None:
        return None, "invalid_embedding", None
    threshold = DEFAULT_THRESHOLD if threshold is None else float(threshold)
    margin = DEFAULT_MARGIN if margin is None else float(margin)
    if not -1.0 <= threshold <= 1.0 or not 0.0 <= margin <= 2.0:
        raise ValueError("Invalid face matching threshold configuration.")
    ranked = []
    for student_id, stored in registrations:
        vector = _vector(stored)
        if vector is not None and vector.shape == query.shape:
            score = float(np.dot(query, vector))
            ranked.append((score, student_id))
    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked:
        return None, "no_registered_embeddings", None
    best_score, best_id = ranked[0]
    second_score = ranked[1][0] if len(ranked) > 1 else None
    if best_score < threshold:
        return None, "unknown_face", best_score
    if second_score is not None and best_score - second_score < margin:
        return None, "ambiguous_face", best_score
    return best_id, "matched", best_score

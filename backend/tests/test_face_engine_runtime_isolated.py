"""Real face-model smoke checks with synthetic non-person imagery only."""

import unittest

import cv2
import numpy as np

from app.services.face_engine import embedding_from_image, identify_embedding, is_valid_embedding


class FaceEngineRuntimeTests(unittest.TestCase):
    def test_installed_models_reject_blank_frame_without_creating_embedding(self):
        encoded, image = cv2.imencode(".jpg", np.zeros((320, 320, 3), dtype=np.uint8))
        self.assertTrue(encoded)
        with self.assertRaisesRegex(ValueError, "No face detected"):
            embedding_from_image(image.tobytes())

    def test_embedding_match_unknown_and_ambiguous_paths(self):
        first = [1.0] + [0.0] * 127
        orthogonal = [0.0, 1.0] + [0.0] * 126
        self.assertTrue(is_valid_embedding(first))
        self.assertEqual(identify_embedding(first, [(1, first)])[0:2], (1, "matched"))
        self.assertEqual(identify_embedding(first, [(2, orthogonal)])[0:2], (None, "unknown_face"))
        self.assertEqual(
            identify_embedding(first, [(1, first), (2, first)])[0:2],
            (None, "ambiguous_face"),
        )


if __name__ == "__main__":
    unittest.main()

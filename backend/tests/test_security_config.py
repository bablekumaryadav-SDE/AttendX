"""JWT policy checks that never print or persist secret material."""
import unittest

from app.security import validate_jwt_settings


class JwtConfigurationTests(unittest.TestCase):
    def test_accepts_strong_key_hs256_and_configurable_positive_expiry(self):
        self.assertEqual(validate_jwt_settings("k" * 32, "HS256", "45"), 45)

    def test_rejects_missing_placeholder_and_short_secrets_without_echoing_them(self):
        for secret in (None, "attendx-development-secret-key-change-later", "private-short-test-secret"):
            with self.subTest(secret_present=bool(secret)), self.assertRaises(RuntimeError) as raised:
                validate_jwt_settings(secret, "HS256", 60)
            if secret:
                self.assertNotIn(secret, str(raised.exception))

    def test_rejects_non_hs256_algorithm(self):
        with self.assertRaisesRegex(RuntimeError, "must be HS256"):
            validate_jwt_settings("k" * 32, "none", 60)

    def test_rejects_invalid_or_nonpositive_expiry(self):
        for expiry in ("not-an-integer", 0, -1):
            with self.subTest(expiry=expiry), self.assertRaises(RuntimeError):
                validate_jwt_settings("k" * 32, "HS256", expiry)


if __name__ == "__main__":
    unittest.main()

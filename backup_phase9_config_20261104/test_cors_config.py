"""CORS origin configuration validation."""
import unittest
from unittest.mock import patch

from app.config import DEFAULT_ALLOWED_ORIGINS, get_allowed_origins, parse_allowed_origins


class CorsConfigTests(unittest.TestCase):
    def test_defaults_retain_local_development_origins(self):
        self.assertEqual(parse_allowed_origins(None), list(DEFAULT_ALLOWED_ORIGINS))
        self.assertEqual(parse_allowed_origins("  "), list(DEFAULT_ALLOWED_ORIGINS))

    def test_explicit_origins_are_trimmed_and_deduplicated(self):
        self.assertEqual(
            parse_allowed_origins(" https://attendx.example,https://admin.example/,https://attendx.example "),
            ["https://attendx.example", "https://admin.example"],
        )

    def test_wildcard_and_non_origin_urls_are_rejected(self):
        for value in ("*", "https://example.org/path", "ftp://example.org", "https://user@example.org"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_allowed_origins(value)

    def test_environment_configuration_is_used_and_invalid_value_fails_closed(self):
        with patch.dict("os.environ", {"CORS_ALLOWED_ORIGINS": "https://attendx.example"}):
            self.assertEqual(get_allowed_origins(), ["https://attendx.example"])
        with patch.dict("os.environ", {"CORS_ALLOWED_ORIGINS": "*"}):
            with self.assertRaises(RuntimeError):
                get_allowed_origins()


if __name__ == "__main__":
    unittest.main()

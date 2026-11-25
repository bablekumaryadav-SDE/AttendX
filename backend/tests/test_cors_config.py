"""CORS origin configuration validation."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware

from app.config import (
    ALLOWED_CORS_HEADERS,
    ALLOWED_CORS_METHODS,
    CORS_ALLOW_CREDENTIALS,
    DEFAULT_ALLOWED_ORIGINS,
    get_allowed_origins,
    parse_allowed_origins,
)
from app.main import app


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

    def test_cors_policy_matches_bearer_auth_with_explicit_methods_and_headers(self):
        cors = next(item for item in app.user_middleware if item.cls is CORSMiddleware)
        options = cors.kwargs
        self.assertFalse(options["allow_credentials"])
        self.assertEqual(tuple(options["allow_methods"]), ALLOWED_CORS_METHODS)
        self.assertEqual(tuple(options["allow_headers"]), ALLOWED_CORS_HEADERS)
        self.assertIn("PATCH", ALLOWED_CORS_METHODS)
        self.assertIn("Authorization", ALLOWED_CORS_HEADERS)
        self.assertIn("Content-Type", ALLOWED_CORS_HEADERS)
        self.assertNotIn("*", options["allow_origins"])

    def test_cors_preflight_accepts_expected_local_client_and_rejects_other_origin(self):
        origin = DEFAULT_ALLOWED_ORIGINS[0]
        with TestClient(app) as client:
            accepted = client.options("/health", headers={
                "Origin": origin,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "authorization,content-type",
            })
            self.assertEqual(accepted.status_code, 200, accepted.text)
            self.assertEqual(accepted.headers.get("access-control-allow-origin"), origin)
            self.assertIsNone(accepted.headers.get("access-control-allow-credentials"))
            self.assertIn("PATCH", accepted.headers.get("access-control-allow-methods", ""))

            rejected = client.get("/health", headers={"Origin": "https://not-configured.invalid"})
            self.assertNotIn("access-control-allow-origin", rejected.headers)


if __name__ == "__main__":
    unittest.main()

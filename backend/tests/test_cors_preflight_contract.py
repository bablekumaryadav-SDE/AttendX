"""CORS preflight contract without starting FastAPI or connecting to a database."""

import asyncio
import unittest

from app.config import (
    ALLOWED_CORS_HEADERS,
    ALLOWED_CORS_METHODS,
    CORS_ALLOW_CREDENTIALS,
    DEFAULT_ALLOWED_ORIGINS,
)
from app.main import app


class CorsPreflightContractTests(unittest.TestCase):
    def test_college_profile_patch_preflight_allows_bearer_headers_without_cookies(self):
        headers = [
            (b"origin", b"http://localhost:5173"),
            (b"access-control-request-method", b"PATCH"),
            (b"access-control-request-headers", b"authorization,content-type"),
        ]
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        asyncio.run(app(
            {"type": "http", "method": "OPTIONS", "path": "/tenant/pilot/college-profile", "headers": headers},
            receive,
            send,
        ))
        start = next(message for message in messages if message["type"] == "http.response.start")
        response_headers = {key.lower(): value for key, value in start["headers"]}
        self.assertEqual(start["status"], 200)
        self.assertEqual(response_headers[b"access-control-allow-origin"], b"http://localhost:5173")
        self.assertIn(b"PATCH", response_headers[b"access-control-allow-methods"])
        allowed_headers = response_headers[b"access-control-allow-headers"].lower()
        self.assertIn(b"authorization", allowed_headers)
        self.assertIn(b"content-type", allowed_headers)
        self.assertNotIn(b"access-control-allow-credentials", response_headers)
        self.assertEqual(tuple(ALLOWED_CORS_METHODS).count("PATCH"), 1)
        self.assertFalse(CORS_ALLOW_CREDENTIALS)


if __name__ == "__main__":
    unittest.main()

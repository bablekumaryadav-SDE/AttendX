"""Shared password policy for account creation and invitation setup."""

import re


def is_password_policy_valid(password: str) -> bool:
    if not isinstance(password, str):
        return False
    return (
        len(password) >= 12
        and len(password.encode("utf-8")) <= 72
        and re.search(r"[a-z]", password) is not None
        and re.search(r"[A-Z]", password) is not None
        and re.search(r"\d", password) is not None
        and re.search(r"[^A-Za-z0-9]", password) is not None
    )

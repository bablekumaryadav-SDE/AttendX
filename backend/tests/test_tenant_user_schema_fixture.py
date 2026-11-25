"""Database-free checks for the synthetic tenant users(id) DDL fixture."""

import os
import re
import unittest

from scripts.generate_tenant_user_schema_fixture import (
    DEFAULT_FIXTURE,
    TENANT_DRAFT,
    _load_user_model,
    render_fixture,
    validate_fixture,
    validate_tenant_draft,
)


class TenantUserSchemaFixtureTests(unittest.TestCase):
    def test_fixture_contains_only_integer_users_primary_key(self):
        sql = render_fixture()
        validate_fixture(sql)
        self.assertIn("CREATE TABLE public.users", sql)
        self.assertIn("id INTEGER NOT NULL", sql)
        self.assertIn("PRIMARY KEY (id)", sql)
        self.assertNotIn("email", sql.lower())
        ddl = re.sub(r"(?m)^\s*--.*$", "", sql).lower()
        self.assertNotIn("insert", ddl)

    def test_fixture_matches_reviewed_sql_file(self):
        self.assertEqual(DEFAULT_FIXTURE.read_text(encoding="utf-8"), render_fixture())

    def test_fixture_source_id_is_sqlalchemy_integer_primary_key(self):
        model_id = _load_user_model().__table__.c.id
        self.assertEqual(model_id.type.__class__.__name__, "Integer")
        self.assertTrue(model_id.primary_key)

    def test_v2_draft_has_four_integer_users_foreign_keys(self):
        validate_tenant_draft(TENANT_DRAFT.read_text(encoding="utf-8"))

    def test_fixture_generation_does_not_modify_process_environment(self):
        before = os.environ.copy()
        render_fixture()
        self.assertEqual(dict(os.environ), dict(before))

    def test_validator_rejects_insert_and_redundant_index(self):
        with self.assertRaises(ValueError):
            validate_fixture(
                "CREATE TABLE public.users (id INTEGER NOT NULL, PRIMARY KEY (id));\n"
                "INSERT INTO public.users (id) VALUES (1);"
            )
        with self.assertRaises(ValueError):
            validate_fixture(
                "CREATE TABLE public.users (id INTEGER NOT NULL, PRIMARY KEY (id));\n"
                "CREATE INDEX ix_users_id ON public.users (id);"
            )


if __name__ == "__main__":
    unittest.main()

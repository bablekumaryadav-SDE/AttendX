"""OpenAPI route metadata checks; imports app with isolated test DB config."""

import unittest

from app.main import app


class TenantSubjectOpenApiTests(unittest.TestCase):
    def test_only_reviewed_subject_methods_are_published_as_tenant_operations(self):
        paths = app.openapi()["paths"]
        self.assertEqual(
            {method for method in paths["/subjects/"] if method != "parameters"},
            {"get", "post"},
        )
        self.assertEqual(
            {method for method in paths["/subjects/{subject_id}"] if method != "parameters"},
            {"get", "patch", "delete"},
        )
        expected_ids = {
            ("/subjects/", "get"): "list_tenant_subjects_subjects__get",
            ("/subjects/", "post"): "create_tenant_subject_subjects__post",
            ("/subjects/{subject_id}", "get"): "read_tenant_subject_subjects__subject_id__get",
            ("/subjects/{subject_id}", "patch"): "update_tenant_subject_subjects__subject_id__patch",
            ("/subjects/{subject_id}", "delete"): "deactivate_tenant_subject_subjects__subject_id__delete",
        }
        for (path, method), operation_id in expected_ids.items():
            with self.subTest(path=path, method=method):
                operation = paths[path][method]
                self.assertEqual(operation["operationId"], operation_id)
                self.assertIn("Tenant Subjects", operation["tags"])

    def test_unreviewed_subject_methods_remain_absent(self):
        paths = app.openapi()["paths"]
        self.assertNotIn("put", paths["/subjects/{subject_id}"])
        self.assertNotIn("delete", paths["/subjects/"])


if __name__ == "__main__":
    unittest.main()

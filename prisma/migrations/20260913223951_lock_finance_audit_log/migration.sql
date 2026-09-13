-- Append-only enforcement for the finance audit log (spec 5.9): no
-- application code path should be able to update or delete a log row, so we
-- remove that privilege at the database role level rather than trusting
-- every call site to behave.
--
-- CAVEAT: this only has teeth if the role connecting at runtime is a
-- non-superuser. Postgres superusers bypass all ACL checks, including this
-- REVOKE — so a local/dev setup using a superuser role (as this project's
-- docker-compose default does) will NOT actually be blocked by this
-- migration. Provisioning a dedicated, non-superuser application role is a
-- production deployment step, not something this migration can do on its
-- own behalf since it doesn't know the target role name in advance.
REVOKE ALL ON TABLE "FinanceAuditLog" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "FinanceAuditLog" TO CURRENT_USER;


-- Bank database seed data
-- Execute in bank_db.

TRUNCATE TABLE
    public.bank_account,
    public.distributed_participant_commits
RESTART IDENTITY;

INSERT INTO public.bank_account (
    customer_id,
    balance
)
VALUES
    (1, 500.00),
    (2, 750.00),
    (3, 1200.00),
    (4, 300.00),
    (5, 950.00);

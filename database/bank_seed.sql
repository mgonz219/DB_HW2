
-- Bank database seed data
-- Execute in bank_db.

TRUNCATE TABLE
    public.bank_account,
    public.distributed_participant_commits
RESTART IDENTITY;

-- Customer bank accounts
INSERT INTO public.bank_account (
    customer_id,
    account_type,
    balance
)
VALUES
    (1, 'CUSTOMER', 500.00),
    (2, 'CUSTOMER', 750.00),
    (3, 'CUSTOMER', 1200.00),
    (4, 'CUSTOMER', 300.00),
    (5, 'CUSTOMER', 950.00);

-- Supermarket company receiving account
INSERT INTO public.bank_account (
    customer_id,
    account_type,
    balance
)
VALUES (
    NULL,
    'COMPANY',
    0.00
);

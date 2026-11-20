INSERT INTO state_tax (state, tax_rate)
VALUES
    ('TX', 0.0825),
    ('CA', 0.0725),
    ('NY', 0.0400),
    ('FL', 0.0600);

INSERT INTO store (name, address, city, state, zip)
VALUES
    ('Supermarket Houston', '123 Main St', 'Houston', 'TX', '77002'),
    ('Supermarket Dallas', '456 Oak St', 'Dallas', 'TX', '75201'),
    ('Supermarket Los Angeles', '789 Pine St', 'Los Angeles', 'CA', '90001'),
    ('Supermarket Miami', '321 Palm St', 'Miami', 'FL', '33101'),
    ('Supermarket New York', '654 Broadway', 'New York', 'NY', '10001');


INSERT INTO aisle (store_id, aisle_number, category)
VALUES
    (1, 1, 'Produce'),
    (1, 2, 'Dairy'),
    (1, 3, 'Meat'),
    (1, 4, 'Frozen Foods'),
    (1, 5, 'Household'),

    (2, 1, 'Produce'),
    (2, 2, 'Dairy'),
    (2, 3, 'Meat'),
    (2, 4, 'Frozen Foods'),
    (2, 5, 'Household'),

    (3, 1, 'Produce'),
    (3, 2, 'Dairy'),
    (3, 3, 'Meat'),
    (3, 4, 'Frozen Foods'),
    (3, 5, 'Household'),

    (4, 1, 'Produce'),
    (4, 2, 'Dairy'),
    (4, 3, 'Meat'),
    (4, 4, 'Frozen Foods'),
    (4, 5, 'Household'),

    (5, 1, 'Produce'),
    (5, 2, 'Dairy'),
    (5, 3, 'Meat'),
    (5, 4, 'Frozen Foods'),
    (5, 5, 'Household');

INSERT INTO product (sku, name, price, taxable, by_weight)
VALUES
    ('1001', 'Apples', 1.49, FALSE, TRUE),
    ('1002', 'Bananas', 0.69, FALSE, TRUE),
    ('1003', 'Milk', 3.99, FALSE, FALSE),
    ('1004', 'Eggs', 4.49, FALSE, FALSE),
    ('1005', 'Chicken Breast', 8.99, FALSE, FALSE),
    ('1006', 'Ground Beef', 7.49, FALSE, FALSE),
    ('1007', 'Frozen Pizza', 5.99, FALSE, FALSE),
    ('1008', 'Ice Cream', 4.99, FALSE, FALSE),
    ('1009', 'Dish Soap', 3.49, TRUE, FALSE),
    ('1010', 'Paper Towels', 9.99, TRUE, FALSE);

INSERT INTO inventory (store_id, sku, aisle_number, quantity)
VALUES
    (1, '1001', 1, 100),
    (1, '1002', 1, 150),
    (1, '1003', 2, 50),
    (1, '1004', 2, 80),
    (1, '1005', 3, 40),
    (1, '1006', 3, 35),
    (1, '1007', 4, 60),
    (1, '1008', 4, 45),
    (1, '1009', 5, 70),
    (1, '1010', 5, 90);

INSERT INTO customer (first_name, last_name, email, phone)
VALUES
    ('John', 'Smith', 'john@example.com', '7135550101'),
    ('Sarah', 'Johnson', 'sarah@example.com', '2145550102'),
    ('Michael', 'Brown', 'michael@example.com', '3105550103'),
    ('Emily', 'Davis', 'emily@example.com', '3055550104'),
    ('David', 'Wilson', 'david@example.com', '2125550105');
	

-- PHASE 2: Generate 95 additional stores.
-- The original five stores have IDs 1 through 5.

INSERT INTO store (name, address, city, state, zip)
SELECT
    'Supermarket Branch ' || n,
    n || ' Market Street',
    CASE (n % 4)
        WHEN 0 THEN 'Houston'
        WHEN 1 THEN 'Los Angeles'
        WHEN 2 THEN 'New York'
        ELSE 'Miami'
    END,
    CASE (n % 4)
        WHEN 0 THEN 'TX'
        WHEN 1 THEN 'CA'
        WHEN 2 THEN 'NY'
        ELSE 'FL'
    END,
    CASE (n % 4)
        WHEN 0 THEN '77002'
        WHEN 1 THEN '90001'
        WHEN 2 THEN '10001'
        ELSE '33101'
    END
FROM generate_series(6, 100) AS n
ORDER BY n;


-- Ensure all 100 stores have 25 aisles.
-- Existing aisle records will be preserved.

INSERT INTO aisle (store_id, aisle_number, category)
SELECT
    s.store_id,
    a.aisle_number,
    CASE
        WHEN a.aisle_number = 1 THEN 'Produce'
        WHEN a.aisle_number = 2 THEN 'Dairy'
        WHEN a.aisle_number = 3 THEN 'Meat'
        WHEN a.aisle_number = 4 THEN 'Frozen Foods'
        WHEN a.aisle_number = 5 THEN 'Household'
        WHEN a.aisle_number BETWEEN 6 AND 10 THEN 'Groceries'
        WHEN a.aisle_number BETWEEN 11 AND 15 THEN 'Beverages'
        WHEN a.aisle_number BETWEEN 16 AND 20 THEN 'Personal Care'
        ELSE 'General Merchandise'
    END
FROM store AS s
CROSS JOIN generate_series(1, 25) AS a(aisle_number)
ON CONFLICT (store_id, aisle_number) DO NOTHING;


-- Add inventory at stores 2 through 100.
-- Store 1 retains its original inventory.

INSERT INTO inventory (
    store_id,
    sku,
    aisle_number,
    quantity
)
SELECT
    s.store_id,
    p.sku,
    p.aisle_number,
    50 + (s.store_id % 20)
FROM store AS s
CROSS JOIN (
    VALUES
        ('1001', 1),
        ('1002', 1),
        ('1003', 2),
        ('1004', 2),
        ('1005', 3),
        ('1006', 3),
        ('1007', 4),
        ('1008', 4),
        ('1009', 5),
        ('1010', 5)
) AS p(sku, aisle_number)
WHERE s.store_id BETWEEN 2 AND 100
ON CONFLICT (store_id, sku) DO NOTHING;





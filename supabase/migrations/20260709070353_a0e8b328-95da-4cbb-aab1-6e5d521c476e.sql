-- Atomically reject a second booking on the same unit while it is still
-- Active or Completed. Cancelled/Transferred bookings free the unit so it
-- can be re-booked. Two concurrent inserts race the index build; Postgres
-- guarantees at most one wins with a serialized 23505 unique_violation.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_unit_active_uniq
  ON public.bookings (unit_id)
  WHERE booking_status IN ('Active', 'Completed');
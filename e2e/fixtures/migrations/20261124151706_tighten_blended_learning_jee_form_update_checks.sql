-- Mirrors db-service 20261124151706_tighten_blended_learning_jee_form_update_checks:
-- a JEE form update's reasons can't repeat, and academic_year must be YYYY-YYYY with
-- consecutive years (the same check the Mapping tables have).
-- Re-runnable: uses CREATE OR REPLACE FUNCTION and DROP CONSTRAINT IF EXISTS.

-- Requires an element type with an equality operator (e.g. not json).
CREATE OR REPLACE FUNCTION public.blended_learning_array_has_no_duplicates(arr anyarray)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    arr IS NULL
    OR cardinality(arr) = (
      SELECT count(*) FROM (SELECT DISTINCT elem FROM unnest(arr) AS elem) AS distinct_elems
    );
$$;

ALTER TABLE public.blended_learning_jee_form_updates
  DROP CONSTRAINT IF EXISTS bl_jee_form_updates_reasons_unique_check;

ALTER TABLE public.blended_learning_jee_form_updates
  ADD CONSTRAINT bl_jee_form_updates_reasons_unique_check
  CHECK (reasons IS NULL OR public.blended_learning_array_has_no_duplicates(reasons));

ALTER TABLE public.blended_learning_jee_form_updates
  DROP CONSTRAINT IF EXISTS bl_jee_form_updates_academic_year_check;

ALTER TABLE public.blended_learning_jee_form_updates
  DROP CONSTRAINT IF EXISTS bl_jee_form_updates_academic_year_format_check;

ALTER TABLE public.blended_learning_jee_form_updates
  ADD CONSTRAINT bl_jee_form_updates_academic_year_format_check
  CHECK (
    CASE
      WHEN academic_year ~ '^[0-9]{4}-[0-9]{4}$'
        THEN substring(academic_year FROM 6 FOR 4)::integer =
             substring(academic_year FROM 1 FOR 4)::integer + 1
      ELSE false
    END
  );

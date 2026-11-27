-- Mirrors db-service 20261124142920_add_key_to_blended_learning_common_action_items
-- (pg_dump-identical; see patterns/mirror-db-service-schema-in-e2e.md): a hidden, fixed
-- key af_lms finds the JEE reminder by, so renaming it can't break the JEE form's auto-tick.
-- Re-runnable: IF NOT EXISTS, and the CHECK dropped before it is added.

ALTER TABLE public.blended_learning_common_action_items
  ADD COLUMN IF NOT EXISTS key character varying(64);

ALTER TABLE public.blended_learning_common_action_items
  DROP CONSTRAINT IF EXISTS bl_common_action_items_key_check;

ALTER TABLE public.blended_learning_common_action_items
  ADD CONSTRAINT bl_common_action_items_key_check CHECK (key IS NULL OR key ~ '^[a-z][a-z0-9_]*$');

CREATE UNIQUE INDEX IF NOT EXISTS bl_common_action_items_key_unique
  ON public.blended_learning_common_action_items (key)
  WHERE key IS NOT NULL AND removed_at IS NULL;

UPDATE public.blended_learning_common_action_items SET key = 'jee_form_reminder'
WHERE id = (SELECT min(id) FROM public.blended_learning_common_action_items
            WHERE lower(btrim(regexp_replace(text, '\s+', ' ', 'g'))) = 'jee form filling (reminder)'
              AND removed_at IS NULL)
AND NOT EXISTS (SELECT 1 FROM public.blended_learning_common_action_items
                WHERE key = 'jee_form_reminder' AND removed_at IS NULL);

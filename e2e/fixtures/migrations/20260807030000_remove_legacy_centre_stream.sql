DROP INDEX IF EXISTS public.centres_stream_codes_index;

ALTER TABLE public.centres
  DROP COLUMN IF EXISTS stream_codes;

DELETE FROM public.centre_options
WHERE option_set_id IN (
  SELECT id FROM public.centre_option_sets WHERE code = 'stream'
);

DELETE FROM public.centre_option_sets
WHERE code = 'stream';

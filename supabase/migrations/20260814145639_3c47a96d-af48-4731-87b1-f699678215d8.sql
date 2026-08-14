ALTER TABLE public.consultation_summaries
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS follow_up text,
  ADD COLUMN IF NOT EXISTS extraction jsonb,
  ADD COLUMN IF NOT EXISTS generated_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.medical_points
  ADD COLUMN IF NOT EXISTS evidence text;

CREATE INDEX IF NOT EXISTS medical_points_consultation_idx ON public.medical_points(consultation_id);
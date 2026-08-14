-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'clinician',
  specialty TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- consultations
CREATE TABLE public.consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New consultation',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consultations_user_idx ON public.consultations (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultations TO authenticated;
GRANT ALL ON public.consultations TO service_role;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own consultations" ON public.consultations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- helper
CREATE OR REPLACE FUNCTION public.owns_consultation(_consultation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultations c WHERE c.id = _consultation_id AND c.user_id = auth.uid());
$$;

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('PATIENT','AI_DOCTOR','SYSTEM')),
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_consultation_idx ON public.messages (consultation_id, timestamp);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.messages FOR ALL TO authenticated USING (public.owns_consultation(consultation_id)) WITH CHECK (public.owns_consultation(consultation_id));

-- medical_points
CREATE TABLE public.medical_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'symptom',
  content TEXT NOT NULL,
  confidence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX medical_points_consultation_idx ON public.medical_points (consultation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medical_points TO authenticated;
GRANT ALL ON public.medical_points TO service_role;
ALTER TABLE public.medical_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own medical points" ON public.medical_points FOR ALL TO authenticated USING (public.owns_consultation(consultation_id)) WITH CHECK (public.owns_consultation(consultation_id));

-- consultation_summaries
CREATE TABLE public.consultation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL UNIQUE REFERENCES public.consultations(id) ON DELETE CASCADE,
  chief_complaint TEXT,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_summaries TO authenticated;
GRANT ALL ON public.consultation_summaries TO service_role;
ALTER TABLE public.consultation_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own summaries" ON public.consultation_summaries FOR ALL TO authenticated USING (public.owns_consultation(consultation_id)) WITH CHECK (public.owns_consultation(consultation_id));

-- citations
CREATE TABLE public.citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  source_title TEXT NOT NULL,
  source_url TEXT,
  snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX citations_consultation_idx ON public.citations (consultation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.citations TO authenticated;
GRANT ALL ON public.citations TO service_role;
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own citations" ON public.citations FOR ALL TO authenticated USING (public.owns_consultation(consultation_id)) WITH CHECK (public.owns_consultation(consultation_id));

-- auto profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
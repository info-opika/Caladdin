-- Atomic invitee slot claim — selected_slot taken from offered_slots[p_slot_index] under row lock.
CREATE OR REPLACE FUNCTION public.claim_scheduling_slot_for_gcal(p_token text, p_slot_index int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scheduling_sessions%ROWTYPE;
  slots jsonb;
  picked jsonb;
  rcount int;
BEGIN
  IF p_slot_index IS NULL OR p_slot_index NOT IN (0, 1) THEN
    RETURN false;
  END IF;

  SELECT * INTO s FROM public.scheduling_sessions WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF s.status IS DISTINCT FROM 'pending' OR s.google_event_id IS NOT NULL THEN
    RETURN false;
  END IF;

  slots := s.offered_slots;
  IF slots IS NULL OR jsonb_typeof(slots) != 'array' OR jsonb_array_length(slots) <= p_slot_index THEN
    RETURN false;
  END IF;

  picked := slots->p_slot_index;
  IF picked IS NULL OR jsonb_typeof(picked) != 'object' THEN
    RETURN false;
  END IF;

  UPDATE public.scheduling_sessions
  SET
    selected_slot = picked,
    google_event_id = '__CALADDIN_GCAL_CLAIMING__',
    updated_at = now()
  WHERE id = s.id
    AND status = 'pending'
    AND google_event_id IS NULL;

  GET DIAGNOSTICS rcount = ROW_COUNT;
  RETURN rcount = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_scheduling_slot_for_gcal(text, int) TO service_role;

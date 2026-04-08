-- 003_cell_params_preset_fk.sql
-- Migrate designs.cell_params JSONB → cell_params_preset_id FK into cell_param_presets
-- Safe to run multiple times (idempotent via IF NOT EXISTS / ON CONFLICT guards).

BEGIN;

-- 1. Add FK column if not present
ALTER TABLE designs
  ADD COLUMN IF NOT EXISTS cell_params_preset_id UUID
  REFERENCES cell_param_presets(id) ON DELETE RESTRICT;

-- 2. Relax the old NOT NULL so new rows can skip the inline snapshot
ALTER TABLE designs
  ALTER COLUMN cell_params DROP NOT NULL;

-- 3. Backfill: for every design that has cell_params JSONB but no FK,
--    create a matching preset (name = "<design name> params", deduping by unique name)
--    and link the design to it.
DO $$
DECLARE
  d RECORD;
  preset_name TEXT;
  preset_id UUID;
  suffix INT;
BEGIN
  FOR d IN
    SELECT id, name, cell_params
    FROM designs
    WHERE cell_params_preset_id IS NULL
      AND cell_params IS NOT NULL
  LOOP
    preset_name := COALESCE(d.name, 'design') || ' params';
    suffix := 1;
    -- Ensure unique name
    WHILE EXISTS (SELECT 1 FROM cell_param_presets WHERE name = preset_name) LOOP
      suffix := suffix + 1;
      preset_name := COALESCE(d.name, 'design') || ' params ' || suffix;
    END LOOP;

    INSERT INTO cell_param_presets (name, params)
    VALUES (preset_name, d.cell_params)
    RETURNING id INTO preset_id;

    UPDATE designs SET cell_params_preset_id = preset_id WHERE id = d.id;
  END LOOP;
END$$;

COMMIT;

-- Add 'handled' status to reminder_status enum
ALTER TYPE reminder_status ADD VALUE IF NOT EXISTS 'handled';

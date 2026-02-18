ALTER TABLE commission ADD COLUMN source_file_id TEXT REFERENCES supplier_file_upload(id) ON DELETE SET NULL;
CREATE INDEX idx_commission_source_file ON commission(source_file_id);

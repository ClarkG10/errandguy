-- Migration 003: Create runner_documents table
CREATE TABLE runner_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    runner_id UUID NOT NULL REFERENCES runner_profiles(id) ON DELETE CASCADE,
    document_type VARCHAR(25) NOT NULL CHECK (document_type IN ('government_id', 'selfie', 'vehicle_registration', 'vehicle_photo', 'drivers_license')),
    file_url TEXT NOT NULL,
    status VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runner_documents_runner_id ON runner_documents (runner_id);

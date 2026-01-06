-- Agentic Core Database Schema
-- PostgreSQL 16 with pgvector extension

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Workflows table
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    config JSONB NOT NULL,
    working_dir TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_created ON workflows(created_at DESC);

-- Step outputs (canonical storage)
CREATE TABLE step_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    step_name VARCHAR(255) NOT NULL,
    output_type VARCHAR(50) NOT NULL,
    content TEXT,
    file_path TEXT,
    file_hash VARCHAR(64),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(workflow_id, step_name)
);

CREATE INDEX idx_step_outputs_workflow ON step_outputs(workflow_id);

-- Agents table (registered agents)
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    icon VARCHAR(10),
    provider VARCHAR(50) DEFAULT 'claude',
    model VARCHAR(100),
    persona TEXT,
    tools TEXT[],
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent sessions (for resume capability)
CREATE TABLE agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    session_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_sessions_workflow ON agent_sessions(workflow_id);
CREATE INDEX idx_agent_sessions_agent ON agent_sessions(agent_name);

-- Workflow checkpoints (for recovery)
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    step_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    kafka_offset BIGINT,
    state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_workflow ON checkpoints(workflow_id, created_at DESC);

-- Messages log (mirror of Kafka for queryability)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    agent_name VARCHAR(100),
    message_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    kafka_topic VARCHAR(100),
    kafka_offset BIGINT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_workflow ON messages(workflow_id, created_at);
CREATE INDEX idx_messages_agent ON messages(agent_name, created_at);

-- Embedding models registry (for configurable dimensions)
CREATE TABLE embedding_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    dimensions INTEGER NOT NULL,
    provider VARCHAR(50) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default embedding model
INSERT INTO embedding_models (name, dimensions, provider, is_default)
VALUES ('all-MiniLM-L6-v2', 384, 'sentence-transformers', TRUE);

-- Long-term memory (semantic search via pgvector)
CREATE TABLE memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    embedding_model VARCHAR(100),
    metadata JSONB,
    workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_memory_embedding ON memory USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_memory_category ON memory(category);

-- Telemetry (detailed audit log)
CREATE TABLE telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    agent_name VARCHAR(100),
    provider VARCHAR(50),
    duration_ms INTEGER,
    tokens_in INTEGER,
    tokens_out INTEGER,
    success BOOLEAN,
    error TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telemetry_workflow ON telemetry(workflow_id, created_at);
CREATE INDEX idx_telemetry_event ON telemetry(event_type, created_at);

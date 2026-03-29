CREATE TABLE whatsapp_connections (
  id              serial       PRIMARY KEY,
  user_id         integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id       integer      NOT NULL,
  phone_number_id varchar(64)  NOT NULL,
  access_token    text         NOT NULL,
  created_at      timestamptz  DEFAULT now(),

  CONSTRAINT whatsapp_connections_phone_number_id_unique UNIQUE (phone_number_id)
);

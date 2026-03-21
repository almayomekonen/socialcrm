CREATE TABLE facebook_pages (
  id                serial        PRIMARY KEY,
  user_id           integer       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id         integer       NOT NULL,
  page_id           varchar(64)   NOT NULL,
  page_name         varchar(255)  NOT NULL,
  page_access_token text          NOT NULL,
  created_at        timestamptz   DEFAULT now(),

  CONSTRAINT facebook_pages_page_id_unique UNIQUE (page_id)
);

CREATE INDEX facebook_pages_user_id_idx ON facebook_pages (user_id);
CREATE INDEX facebook_pages_page_id_idx ON facebook_pages (page_id);

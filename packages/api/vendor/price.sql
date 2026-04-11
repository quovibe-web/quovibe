CREATE TABLE price(
security VARCHAR(36) NOT NULL REFERENCES security(uuid),
tstamp VARCHAR(32) NOT NULL,
value BIGINT NOT NULL
);
CREATE UNIQUE INDEX price__security_tstamp ON price(security, tstamp);

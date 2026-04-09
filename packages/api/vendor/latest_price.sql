CREATE TABLE latest_price(
security VARCHAR(36) NOT NULL PRIMARY KEY REFERENCES security(uuid),
tstamp VARCHAR(32) NOT NULL,
value BIGINT NOT NULL,
open BIGINT,
high BIGINT,
low BIGINT,
volume BIGINT
);

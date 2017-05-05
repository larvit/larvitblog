
-- hårdkodade namn, probläm?
ALTER TABLE blog_entriesData DROP FOREIGN KEY blog_entriesData_ibfk_1;
ALTER TABLE blog_entriesDataImages DROP FOREIGN KEY blog_entriesDataImages_ibfk_1;
ALTER TABLE blog_entriesDataTags DROP FOREIGN KEY blog_entriesDataTags_ibfk_2;

ALTER TABLE blog_entriesData MODIFY COLUMN entryUuid binary(16) NOT NULL;
ALTER TABLE blog_entriesDataImages MODIFY COLUMN entryUuid binary(16) NOT NULL;
ALTER TABLE blog_entriesDataTags MODIFY COLUMN entryUuid binary(16) NOT NULL;

ALTER TABLE blog_entriesData DROP PRIMARY KEY;
ALTER TABLE blog_entriesDataImages DROP PRIMARY KEY;
ALTER TABLE blog_entriesDataTags DROP INDEX entryId;
ALTER TABLE blog_entriesDataTags DROP INDEX entryId_lang;

ALTER TABLE blog_entries MODIFY uuid binary(16) NOT NULL;
ALTER TABLE blog_entries MODIFY COLUMN id INT;
ALTER TABLE blog_entries DROP PRIMARY KEY;
ALTER TABLE blog_entries ADD PRIMARY KEY (uuid);
ALTER TABLE blog_entries DROP COLUMN id;

ALTER TABLE blog_entriesData ADD PRIMARY KEY (entryUuid, lang);
ALTER TABLE blog_entriesDataImages ADD PRIMARY KEY (entryUuid, uri);
ALTER TABLE blog_entriesDataTags ADD INDEX `entryUuid_lang` (entryUuid, lang);
ALTER TABLE blog_entriesDataTags ADD INDEX `entryUuid` (entryUuid);

ALTER TABLE blog_entriesData ADD CONSTRAINT blog_entriesData_ibfk_1 FOREIGN KEY (entryUuid) REFERENCES blog_entries(uuid);
ALTER TABLE blog_entriesDataImages ADD CONSTRAINT blog_entriesDataImages_ibfk_1 FOREIGN KEY (entryUuid) REFERENCES blog_entries(uuid);
ALTER TABLE blog_entriesDataTags ADD CONSTRAINT blog_entriesDataTags_ibfk_2 FOREIGN KEY (entryUuid) REFERENCES blog_entries(uuid);

ALTER TABLE blog_entriesData DROP entryId;
ALTER TABLE blog_entriesDataImages DROP entryId;
ALTER TABLE blog_entriesDataTags DROP entryId;
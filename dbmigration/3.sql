ALTER TABLE `blog_entries` ADD `uuid` binary(16);
ALTER TABLE `blog_entriesData` ADD `entryUuid` binary(16);
ALTER TABLE `blog_entriesDataImages` ADD `entryUuid` binary(16);
ALTER TABLE `blog_entriesDataTags` ADD `entryUuid` binary(16);
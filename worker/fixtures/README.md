These are fictional saved responses with the OpenAlex API response structure.
Names and identifiers are illustrative, not records of real experts or publications.
No fixture was downloaded using an API key. Tests read these files and never call the network.

- Grouped responses use `meta` and `group_by`, with `key`, `key_display_name`, and `count` for each group.
- `papers.json` uses the selected work fields, including `authorships` and `primary_location`.
- `countries.json` uses full OpenAlex country URLs and source-provided display names.
- `experts.json` includes two author IDs sharing the same display name.
- The first paper has four authors to exercise the three-author display limit.
- `early.json` includes a sub-topic with zero early papers.
- `papers.json` includes a paper with no journal or authors.
- `empty-groups.json` and `empty-papers.json` cover successful empty responses.

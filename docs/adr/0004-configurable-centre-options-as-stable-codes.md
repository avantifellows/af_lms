# Store configurable Centre options as stable codes on Centre rows

Centre type, category, sub-category, and stream labels need to be admin-configurable, but Centre rows should remain stable when labels change. `db-service` will own the `centres`, `centre_option_sets`, and `centre_options` tables, while `af_lms` will store option codes on Centre rows (`type_code`, `category_code`, `sub_category_code`, `stream_codes`) and resolve labels through Centre option configuration. Centre options contain only stable codes, display labels, ordering, and active state in v1. This deliberately avoids direct foreign keys from Centre rows to option rows so the admin-configurable model stays simple; AF LMS APIs and import scripts enforce option-code validity.

ADR 0006 supersedes only the Centre Stream part of this decision. Type, category, and sub-category remain stable configurable codes, while issue #252 replaces `stream_codes` with grade-specific Centre Exam Track mappings.

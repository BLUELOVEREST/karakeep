# Inference Language Selection

User-approved follow-up to personal AI settings: replace the free-text-only field with language choices, a custom-language option and an explicit "Follow Interface Language" mode. New/unset inference language defaults to Simplified Chinese; preserve existing explicit and custom values.

Use `inferredTagLang = "interface"` for follow mode and a nullable `user.interfaceLang` column for the last saved interface choice. Saving AI preferences captures the current browser interface language. Changing User Info language persists the account value before updating the existing local interface preference. Across devices, the last saved choice determines background inference; this does not force other devices' display languages to change.

One shared resolver maps follow mode to the supported language name and is used by automatic tags, automatic summaries, manual summaries and prompt previews. Missing interface choice uses the existing English interface default. Explicit inference language is independent of later interface changes. Existing summaries and tags are not regenerated automatically.

Migration `0099_user_interface_language` adds only one nullable column. Tests cover defaults, custom values, follow-mode persistence, unsupported locale rejection and dropdown/custom input behavior. Browser verification uses only the isolated preview database; no paid AI calls, production changes or build tags.

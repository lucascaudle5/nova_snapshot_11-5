# Lucas's settled preferences (binding for views, tools and tests)

Recorded 2026-11-05 from Lucas's answers.

| Topic | Decision |
|---|---|
| Home time zone | **America/Chicago** (US Central; lives in Warrior, Alabama). One home zone; per-record `time_zone` still stored. |
| When a day starts | **Midnight** local time. |
| Week start | **Sunday**. Weekly queries bucket Sunday through Saturday (`strftime('%w')` gives 0 for Sunday; Sunday-based week of year is `%U`). |
| Currency | **USD only**. Money stays integer cents with a currency code; views still group by currency. |
| Habit streaks | **Planned exceptions preserve a streak** (a declared pause or exception neither breaks nor extends it). Show the underlying reports and the pause periods beside the streak. Unreported days still make a streak uncertain; explicit not_done breaks it. |
| First room for real data and first artifact | **Habits**. |
| Spotify | **Do not use the Spotify API** for listening analysis (policy conflict). Use Last.fm and a personal Extended Streaming History export. |
| Calendars | Lucas has no calendars to import. Google or Apple both acceptable later; start with ICS import if needed. |
| Health data | **Google Health / Fitbit** (a Google Fitbit Air), **not** Apple Health. |
| Repository | **Do not push** to GitHub unless Lucas says so. |

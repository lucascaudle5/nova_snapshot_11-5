# View catalog

Reserved ID prefixes: `HAB MND BOD SCH FOC FIN LRN WRK INV REL MUS OVR HIS`.

| ID | Room | Answers | Params | Status |
|---|---|---|---|---|
| BOD-01 | body | docs/schema/body.md#How did intended sleep compare with reported sleep, naps and interruptions? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-02 | body | docs/schema/body.md#What capability/program did I choose, what was prescribed, and what did I actually train? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-03 | body | docs/schema/body.md#What capability/program did I choose, what was prescribed, and what did I actually train? | :exercise_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-04 | body | docs/schema/body.md#What did I plan to eat vs report eating, and what nutrition is knowable? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-05 | body | docs/schema/body.md#What groceries, equipment, cost and preparation time does that plan need? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-06 | body | docs/schema/body.md#How did weight, measurements, photos and health change, and what care remains? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-07 | body | docs/schema/body.md#How did each night break down into stages, and what is unknown? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-08 | body | docs/schema/body.md#What capability/program did I choose, what was prescribed, and what did I actually train? | :program_id TEXT, :limit INTEGER (default 100, max 500) | done |
| BOD-09 | body | docs/schema/body.md#What did I plan to eat vs report eating, and what nutrition is knowable? | :limit INTEGER (default 100, max 500) | done |
| FIN-01 | finances | docs/schema/finances.md#What do I have/owe, as of when, and which records reconcile? | :as_of TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-02 | finances | docs/schema/finances.md#What came in or went out, why, and what did an item/project cost? | :dimension TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-03 | finances | docs/schema/finances.md#What came in or went out, why, and what did an item/project cost? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-04 | finances | docs/schema/finances.md#What is due and what is actually settled? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-05 | finances | docs/schema/finances.md#Does an adopted budget or a possible purchase leave enough cash at the relevant time? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-06 | finances | docs/schema/finances.md#What do I have/owe, as of when, and which records reconcile? | :account_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-07 | finances | docs/schema/finances.md#What progress have I made toward saving, and did a financial choice help? | :as_of TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-08 | finances | docs/schema/finances.md#What came in or went out, why, and what did an item/project cost? | :purpose_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-09 | finances | docs/schema/finances.md#What do I have/owe, as of when, and which records reconcile? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FIN-10 | finances | docs/schema/finances.md#What progress have I made toward saving, and did a financial choice help? | :decision_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-01 | focus | docs/schema/focus.md#What was I trying to do, why, and which scheduled assignment/project/practice did it start? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-02 | focus | docs/schema/focus.md#What time was spent, what interrupted me, and where do I resume? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-06 | focus | docs/schema/focus.md#What time was spent, what interrupted me, and where do I resume? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-03 | focus | docs/schema/focus.md#What time was spent, what interrupted me, and where do I resume? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-04 | focus | docs/schema/focus.md#Which environment was chosen, what actually applied, and what changed? | :as_of_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-05 | focus | docs/schema/focus.md#Why did NOVA intervene, did I override it, and did it help? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| FOC-07 | focus | docs/schema/focus.md#What was I trying to do, why, and which scheduled assignment/project/practice did it start? | :limit INTEGER (default 100, max 500) | done |
| HAB-00 | habits | docs/schema/habits.md#What am I practicing, reducing or replacing, and why? | :as_of_date TEXT, :limit INTEGER (default 100, max 500) | implemented |
| HAB-01 | habits | docs/schema/habits.md#What is my consistency or streak under the standard I chose then? | :habit_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | implemented |
| HAB-02 | habits | docs/schema/habits.md#What is my consistency or streak under the standard I chose then? | :habit_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| HAB-03 | habits | docs/schema/habits.md#What actually happened and where does a routine break down? | :routine_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| HAB-04 | habits | docs/schema/habits.md#What reasons, discomfort or social setting did I report for performance/nonperformance? | :habit_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| HAB-05 | habits | docs/schema/habits.md#How automatic did the habit feel on each reported date, under which scale and if-then plan? | :habit_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| HAB-06 | habits | docs/schema/habits.md#What am I practicing, reducing or replacing, and why? | :habit_id TEXT, :as_of_date TEXT, :limit INTEGER (default 100, max 500) | done |
| HAB-07 | habits | docs/schema/habits.md#What is my consistency or streak under the standard I chose then? | :habit_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | implemented |
| HAB-08 | habits | docs/schema/habits.md#What actually happened and where does a routine break down? | :routine_id TEXT, :local_date TEXT, :limit INTEGER (default 100, max 500) | implemented |
| HAB-09 | habits | docs/schema/habits.md#What actually happened and where does a routine break down? | :habit_id TEXT, :limit INTEGER (default 100, max 500) | implemented |
| HAB-10 | habits | docs/schema/habits.md#What am I practicing, reducing or replacing, and why? | :habit_id TEXT, :limit INTEGER (default 100, max 500) | implemented |
| HIS-01 | history | docs/schema/CONVENTIONS.md#Provenance, corrections, and derived information | :root_id TEXT | done |
| HIS-02 | history | docs/schema/CONVENTIONS.md#Provenance, corrections, and derived information | :root_id TEXT, :limit INTEGER (default 100, max 500) | done |
| HIS-03 | history | docs/schema/CONVENTIONS.md#Provenance, corrections, and derived information | :root_id TEXT, :as_known_at TEXT | done |
| HIS-04 | history | docs/schema/CONVENTIONS.md#Provenance, corrections, and derived information | :root_id TEXT, :effective_at TEXT | done |
| HIS-05 | history | docs/schema/CONVENTIONS.md#Provenance, corrections, and derived information | :from_ingested_at TEXT, :to_ingested_at TEXT, :limit INTEGER (default 100, max 500) | done |
| HIS-06 | history | docs/schema/CONVENTIONS.md#Provenance, corrections, and derived information; docs/schema/CROSS_ROOM.md#Typed record_links registry | :root_id TEXT, :limit INTEGER (default 100, max 500) | done |
| INV-01 | inventory | docs/schema/inventory.md#What exact thing is this, how was it identified, and can I inspect/correct the evidence? | :item_id TEXT, :limit INTEGER (default 100, max 500) | done |
| INV-02 | inventory | docs/schema/inventory.md#Where is it, is it available, and who borrowed/received it? | :item_id TEXT, :limit INTEGER (default 100, max 500) | done |
| INV-03 | inventory | docs/schema/inventory.md#Which clothes fit an occasion and what makes up an outfit? | :collection_id TEXT, :limit INTEGER (default 100, max 500) | done |
| INV-04 | inventory | docs/schema/inventory.md#What care/parts/warranty does it need and when, and was it serviced? | :item_id TEXT, :limit INTEGER (default 100, max 500) | done |
| INV-05 | inventory | docs/schema/inventory.md#What did ownership cost and what activities does it support? | :item_id TEXT, :limit INTEGER (default 100, max 500) | done |
| LRN-01 | learning | docs/schema/learning.md#What am I learning, in which course or independent interest, and from which exact material? | :topic_id TEXT, :limit INTEGER (default 100, max 500) | done |
| LRN-02 | learning | docs/schema/learning.md#What assignments/exams are due, what work is done, and can a study block open it? | :assignment_id TEXT, :limit INTEGER (default 100, max 500) | done |
| LRN-03 | learning | docs/schema/learning.md#Where did my handwriting/diagram come from and what changed? | :ink_document_id TEXT, :limit INTEGER (default 100, max 500) | done |
| LRN-04 | learning | docs/schema/learning.md#Did I ask for a hint or solution, and what evidence supports it? | :subject_id TEXT, :limit INTEGER (default 100, max 500) | done |
| LRN-05 | learning | docs/schema/learning.md#What did I try, what mistakes were identified, and what should I practice next? | :practice_item_id TEXT, :limit INTEGER (default 100, max 500) | done |
| LRN-06 | learning | docs/schema/learning.md#What am I learning, in which course or independent interest, and from which exact material? | :limit INTEGER (default 100, max 500) | done |
| LRN-07 | learning | docs/schema/learning.md#What assignments/exams are due, what work is done, and can a study block open it? | :limit INTEGER (default 100, max 500) | done |
| LRN-08 | learning | docs/schema/learning.md#What did I try, what mistakes were identified, and what should I practice next? | :limit INTEGER (default 100, max 500) | done |
| LRN-09 | learning | docs/schema/learning.md#Where did my handwriting/diagram come from and what changed? | :limit INTEGER (default 100, max 500) | done |
| LRN-10 | learning | docs/schema/learning.md#Did I ask for a hint or solution, and what evidence supports it? | :limit INTEGER (default 100, max 500) | done |
| MND-01 | mind | docs/schema/mind.md#What did I feel, how strongly, and when did I report it? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| MND-02 | mind | docs/schema/mind.md#Did a change precede a reported episode, and did NOVA's prediction hold up? | :from_date TEXT, :to_date TEXT, :window_days INTEGER, :limit INTEGER (default 100, max 500) | done |
| MND-03 | mind | docs/schema/mind.md#What happened with a medication, what should I discuss, and what is the support plan? | :medication_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| MND-04 | mind | docs/schema/mind.md#What happened with a medication, what should I discuss, and what is the support plan? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| MND-05 | mind | docs/schema/mind.md#What happened with a medication, what should I discuss, and what is the support plan? | :limit INTEGER (default 100, max 500) | done |
| MND-06 | mind | docs/schema/mind.md#What did I feel, how strongly, and when did I report it? | :limit INTEGER (default 100, max 500) | done |
| MUS-01 | music | docs/schema/music.md#What did I listen to, when, how often and from which source? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| MUS-02 | music | docs/schema/music.md#What did I listen to, when, how often and from which source? | :from_date TEXT, :to_date TEXT, :gap_seconds INTEGER, :limit INTEGER (default 100, max 500) | done |
| MUS-03 | music | docs/schema/music.md#What changed in my taste, repetition/discovery or lyrical interests? | :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| MUS-04 | music | docs/schema/music.md#What does this song mean to me and which material supports that reading? | :track_id TEXT, :limit INTEGER (default 100, max 500) | done |
| MUS-05 | music | docs/schema/music.md#Why was a song recommended, what did I think, and why this playlist order? | :record_id TEXT, :limit INTEGER (default 100, max 500) | done |
| MUS-06 | music | docs/schema/music.md#What technique did I borrow, what did I try and where do I resume making music? | :production_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| MUS-07 | music | docs/schema/music.md#Why was a song recommended, what did I think, and why this playlist order? | :limit INTEGER (default 100, max 500) | done |
| MUS-08 | music | docs/schema/music.md#What technique did I borrow, what did I try and where do I resume making music? | :limit INTEGER (default 100, max 500) | done |
| OVR-01 | overview | NOVA_FOUNDATION.md#Overview 2 | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| OVR-02 | overview | NOVA_FOUNDATION.md#Overview 1, 4 | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| OVR-03 | overview | NOVA_FOUNDATION.md#Overview 5; docs/schema/schedule.md#Questions the schema must answer | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| OVR-04 | overview | NOVA_FOUNDATION.md#Overview 4; docs/schema/schedule.md#Questions the schema must answer | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| OVR-05 | overview | NOVA_FOUNDATION.md#Overview 2, 5, 8; docs/schema/schedule.md#Questions the schema must answer | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| OVR-06 | overview | NOVA_FOUNDATION.md#Overview 9 | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| OVR-07 | overview | NOVA_FOUNDATION.md#Overview 1, 9; docs/schema/CONVENTIONS.md#Four distinct time concepts | :from_date TEXT, :to_date TEXT, :rooms_json TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-01 | relationships | docs/schema/relationships.md#Who is this, how do I know them, and what did they actually say? | :person_id TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-02 | relationships | docs/schema/relationships.md#Who is this, how do I know them, and what did they actually say? | :interaction_id TEXT, :from_time TEXT, :to_time TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-03 | relationships | docs/schema/relationships.md#Why does NOVA think someone has an interest/preference or a recurring dynamic, and do I disagree? | :person_id TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-04 | relationships | docs/schema/relationships.md#What remains unresolved or promised, by whom, and when? | :person_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-05 | relationships | docs/schema/relationships.md#How do shared expenses, collaborative work, support people and loans/gifts fit in? | :person_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-06 | relationships | docs/schema/relationships.md#Why does NOVA think someone has an interest/preference or a recurring dynamic, and do I disagree? | :person_id TEXT, :first_from TEXT, :first_to TEXT, :second_from TEXT, :second_to TEXT, :limit INTEGER (default 100, max 500) | done |
| REL-07 | relationships | docs/schema/relationships.md#What did I intend to communicate and how did my understanding change? | :person_id TEXT, :from_date TEXT, :to_date TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-01 | schedule | docs/schema/schedule.md#Where does every minute go, and is free time chosen or merely unassigned? | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-02 | schedule | docs/schema/schedule.md#Where does every minute go, and is free time chosen or merely unassigned? | :day_start_utc TEXT, :day_end_utc TEXT | done |
| SCH-03 | schedule | docs/schema/schedule.md#What is fixed, what preparation/travel is needed, and what conflicts? | :day_start_utc TEXT, :day_end_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-04 | schedule | docs/schema/schedule.md#Where does every minute go, and is free time chosen or merely unassigned? | :from_utc TEXT, :to_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-05 | schedule | docs/schema/schedule.md#What needs time and why, and can a study block open its assignment? | :as_of_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-06 | schedule | docs/schema/schedule.md#How did actual use differ and what should change next? | :from_utc TEXT, :to_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-07 | schedule | docs/schema/schedule.md#How did a reusable arrangement or recurrence become today's plan, including exceptions? | :from_utc TEXT, :to_utc TEXT, :limit INTEGER (default 100, max 500) | done |
| SCH-08 | schedule | docs/schema/schedule.md#Where does every minute go, and is free time chosen or merely unassigned? | :limit INTEGER (default 100, max 500) | done |
| SCH-09 | schedule | docs/schema/schedule.md#How did a reusable arrangement or recurrence become today's plan, including exceptions? | :limit INTEGER (default 100, max 500) | done |
| WRK-01 | workshop | docs/schema/workshop.md#Why does this project exist, what would count as useful, and did I choose it or only explore it? | :project_id TEXT, :limit INTEGER (default 100, max 500) | done |
| WRK-02 | workshop | docs/schema/workshop.md#What is ready, blocked or next, and what do I need? | :project_id TEXT, :limit INTEGER (default 100, max 500) | done |
| WRK-03 | workshop | docs/schema/workshop.md#What did I test, how, what happened and what did I learn? | :experiment_id TEXT, :limit INTEGER (default 100, max 500) | done |
| WRK-04 | workshop | docs/schema/workshop.md#Where is my work and why did an approach change? | :project_id TEXT, :limit INTEGER (default 100, max 500) | done |
| WRK-05 | workshop | docs/schema/workshop.md#What did this project cost? | :project_id TEXT, :limit INTEGER (default 100, max 500) | done |
